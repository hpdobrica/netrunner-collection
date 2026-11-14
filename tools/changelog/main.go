// Command changelog checks static/changelog.json against VERSION in static/sw.js, so a deploy can't forget it.
//
//	go run ./tools/changelog                  checks the working tree
//	go run ./tools/changelog -range A..B      also checks every commit in A..B (the Pages workflow passes the push)
//
// Every commit that bumps VERSION must set "checked" to the new VERSION, and either add a line tagged with it
// or say "Changelog: none (reason)" in its message. That makes leaving a visible change out a decision, not
// something forgotten. How to write the lines: .claude/skills/changelog/SKILL.md.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

const (
	swPath  = "static/sw.js"
	logPath = "static/changelog.json"
)

var (
	versionLine = regexp.MustCompile(`(?m)^const VERSION = '([^']*)';`)
	versionForm = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.([1-9]\d*)$`)
	dateForm    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	noneLine    = regexp.MustCompile(`(?m)^Changelog: none\b`)
)

type item struct {
	V    string `json:"v"`
	Text string `json:"text"`
}

type entry struct {
	Date     string `json:"date"`
	New      []item `json:"new"`
	Improved []item `json:"improved"`
	Fixed    []item `json:"fixed"`
}

type changelog struct {
	Checked string  `json:"checked"`
	Entries []entry `json:"entries"`
}

func main() {
	rng := flag.String("range", "", "also check each commit in this git range, e.g. abc123..def456")
	flag.Parse()
	var problems []string
	sw, err1 := os.ReadFile(swPath)
	cl, err2 := os.ReadFile(logPath)
	if err1 != nil || err2 != nil {
		fail([]string{fmt.Sprint("reading files: ", err1, err2)})
	}
	problems = append(problems, check("working tree", sw, cl, "", false)...)
	if *rng != "" {
		problems = append(problems, checkRange(*rng)...)
	}
	fail(problems)
}

func fail(problems []string) {
	if len(problems) == 0 {
		fmt.Println("changelog: ok")
		return
	}
	for _, p := range problems {
		fmt.Fprintln(os.Stderr, "changelog:", p)
	}
	os.Exit(1)
}

// check validates one state of the two files. With bumped set, the VERSION is new in this commit, so it needs a
// line tagged with it unless msg says Changelog: none.
func check(where string, sw, cl []byte, msg string, bumped bool) (problems []string) {
	bad := func(f string, a ...any) { problems = append(problems, where+": "+fmt.Sprintf(f, a...)) }
	m := versionLine.FindSubmatch(sw)
	if m == nil {
		bad("no VERSION line in %s", swPath)
		return
	}
	version := string(m[1])
	if !versionForm.MatchString(version) {
		bad("VERSION %q should look like 2026-11-14.3", version)
		return
	}
	var log changelog
	dec := json.NewDecoder(bytes.NewReader(cl))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&log); err != nil {
		bad("%s: %v", logPath, err)
		return
	}
	if log.Checked != version {
		bad(`"checked" is %q but VERSION is %q: add a line for this version, or set "checked" to it if nothing users can see changed`, log.Checked, version)
	}
	tagged := 0
	prevDate := ""
	for i, e := range log.Entries {
		if !dateForm.MatchString(e.Date) {
			bad("entry %d: date %q should look like 2026-11-14", i, e.Date)
		}
		if prevDate != "" && e.Date >= prevDate {
			bad("entry %s: entries go newest first, one per date", e.Date)
		}
		prevDate = e.Date
		if len(e.New)+len(e.Improved)+len(e.Fixed) == 0 {
			bad("entry %s has no lines", e.Date)
		}
		for _, x := range append(append(append([]item{}, e.New...), e.Improved...), e.Fixed...) {
			vm := versionForm.FindStringSubmatch(x.V)
			switch {
			case vm == nil:
				bad("%s: version %q should look like 2026-11-14.3", e.Date, x.V)
			case vm[1] != e.Date:
				bad("%s: line tagged %s belongs under %s", e.Date, x.V, vm[1])
			case compare(x.V, version) > 0:
				bad("%s: line tagged %s is newer than VERSION %s", e.Date, x.V, version)
			}
			if x.V == version {
				tagged++
			}
			if strings.TrimSpace(x.Text) == "" {
				bad("%s: empty line tagged %s", e.Date, x.V)
			}
		}
	}
	if bumped && tagged == 0 && !noneLine.MatchString(msg) {
		bad("VERSION became %s with no changelog line tagged with it. Add one, or put \"Changelog: none (reason)\" in the commit message", version)
	}
	return
}

func checkRange(rng string) (problems []string) {
	out, err := git("rev-list", "--no-merges", "--reverse", rng)
	if err != nil {
		return []string{fmt.Sprintf("git rev-list %s: %v", rng, err)}
	}
	for _, c := range strings.Fields(out) {
		where := "commit " + c[:min(9, len(c))]
		sw, err := git("show", c+":"+swPath)
		if err != nil {
			continue // no app in this commit
		}
		oldSW, _ := git("show", c+"^:"+swPath)
		ver, oldVer := versionOf(sw), versionOf(oldSW)
		if ver == oldVer {
			continue // no deploy-visible change of version, nothing to check
		}
		if oldVer != "" && compare(ver, oldVer) <= 0 {
			problems = append(problems, fmt.Sprintf("%s: VERSION went from %s to %s; it must only go up", where, oldVer, ver))
		}
		cl, err := git("show", c+":"+logPath)
		if err != nil {
			problems = append(problems, where+": bumps VERSION but has no "+logPath)
			continue
		}
		msg, _ := git("log", "-1", "--format=%B", c)
		problems = append(problems, check(where, []byte(sw), []byte(cl), msg, true)...)
	}
	return
}

func versionOf(sw string) string {
	if m := versionLine.FindStringSubmatch(sw); m != nil {
		return m[1]
	}
	return ""
}

// compare orders versions: the date as text, then the number after the dot as a number (.10 after .9).
func compare(a, b string) int {
	da, na, _ := strings.Cut(a, ".")
	db, nb, _ := strings.Cut(b, ".")
	if c := strings.Compare(da, db); c != 0 {
		return c
	}
	x, _ := strconv.Atoi(na)
	y, _ := strconv.Atoi(nb)
	return x - y
}

func git(args ...string) (string, error) {
	out, err := exec.Command("git", args...).Output()
	return string(out), err
}
