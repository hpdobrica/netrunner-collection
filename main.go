// Netrunner collection manager: a local server for the browser UI in static/.
//
//	netrunner.exe              serve on http://localhost:8765 and open the browser
//	netrunner.exe -port 9000   different port
//	netrunner.exe -no-open     don't open a browser tab
//	netrunner.exe -dev         serve static/ from disk instead of the embedded copy
//	netrunner.exe -lan         also reachable from other devices on your Wi-Fi (phone, tablet)
//
// The collection lives in data/collection.json next to the executable (plain JSON, safe to commit).
// Card data from NetrunnerDB is cached in data/nrdb-cache.json; the UI can refresh it.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

//go:embed static
var embedded embed.FS

const nrdb = "https://netrunnerdb.com/api/2.0/public/"

var (
	dataDir string
	mu      sync.Mutex
	client  = &http.Client{Timeout: 60 * time.Second}
	idRe    = regexp.MustCompile(`^[A-Za-z0-9-]+$`)
)

func main() {
	port := flag.Int("port", 8765, "port to listen on")
	noOpen := flag.Bool("no-open", false, "don't open a browser tab")
	dev := flag.Bool("dev", false, "serve static/ from disk (for editing the UI)")
	lan := flag.Bool("lan", false, "also listen on your local network, e.g. to use it from a phone")
	flag.StringVar(&dataDir, "data", defaultDataDir(), "directory holding collection.json")
	flag.Parse()

	var static http.FileSystem
	if *dev {
		static = http.Dir("static")
	} else {
		sub, _ := fs.Sub(embedded, "static")
		static = http.FS(sub)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", getState)
	mux.HandleFunc("PUT /api/state", putState)
	mux.HandleFunc("GET /api/nrdb", getNrdb)
	mux.HandleFunc("GET /api/decklist/{id}", getDecklist("decklist"))
	mux.HandleFunc("GET /api/deck/{id}", getDecklist("deck"))
	mux.HandleFunc("GET /api/icons.css", getIcons(false))
	mux.HandleFunc("GET /api/icons.woff", getIcons(true))
	files := http.FileServer(static)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	if *lan {
		addr = fmt.Sprintf("0.0.0.0:%d", *port)
	}
	url := fmt.Sprintf("http://localhost:%d/", *port)
	fmt.Printf("Netrunner collection: %s  (data in %s, Ctrl+C to stop)\n", url, dataDir)
	if *lan {
		for _, ip := range lanIPs() {
			fmt.Printf("  on your phone (same Wi-Fi): http://%s:%d/\n", ip, *port)
		}
	}
	if !*noOpen {
		go func() { time.Sleep(500 * time.Millisecond); openBrowser(url) }()
	}
	log.Fatal(http.ListenAndServe(addr, mux))
}

// defaultDataDir is data/ beside the executable, or beside the working directory under `go run`.
func defaultDataDir() string {
	exe, err := os.Executable()
	if err != nil || strings.Contains(exe, "go-build") {
		return "data"
	}
	return filepath.Join(filepath.Dir(exe), "data")
}

func lanIPs() []string {
	var ips []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok && n.IP.IsPrivate() && n.IP.To4() != nil {
			ips = append(ips, n.IP.String())
		}
	}
	return ips
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func sendJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func sendError(w http.ResponseWriter, status int, format string, args ...any) {
	sendJSON(w, status, map[string]string{"error": fmt.Sprintf(format, args...)})
}

// sendRaw writes already-encoded JSON.
func sendRaw(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(body)
}

func writeAtomic(path string, body []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func getState(w http.ResponseWriter, r *http.Request) {
	mu.Lock()
	defer mu.Unlock()
	body, err := os.ReadFile(filepath.Join(dataDir, "collection.json"))
	if os.IsNotExist(err) {
		sendJSON(w, 200, map[string]any{"version": 1, "owned": map[string]any{}, "decks": []any{}, "packStatus": map[string]any{}, "onboarded": false})
		return
	}
	if err != nil {
		sendError(w, 500, "Could not read collection: %v", err)
		return
	}
	sendRaw(w, body)
}

func putState(w http.ResponseWriter, r *http.Request) {
	var state map[string]json.RawMessage
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&state); err != nil {
		sendError(w, 400, "Invalid state: %v", err)
		return
	}
	if state["owned"] == nil || state["decks"] == nil {
		sendError(w, 400, "Invalid state: missing owned/decks")
		return
	}
	body, _ := json.MarshalIndent(state, "", " ")

	mu.Lock()
	defer mu.Unlock()
	path := filepath.Join(dataDir, "collection.json")
	// One backup per day, taken from the previous version before overwriting it.
	if prev, err := os.ReadFile(path); err == nil {
		backup := filepath.Join(dataDir, "backups", "collection-"+time.Now().Format("2006-01-02")+".json")
		if _, err := os.Stat(backup); os.IsNotExist(err) {
			writeAtomic(backup, prev)
		}
	}
	if err := writeAtomic(path, body); err != nil {
		sendError(w, 500, "Could not save collection: %v", err)
		return
	}
	sendJSON(w, 200, map[string]bool{"ok": true})
}

func fetchJSON(url string, v any) error {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "netrunner-collection/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

func getNrdb(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(dataDir, "nrdb-cache.json")
	if r.URL.Query().Get("refresh") != "1" {
		if body, err := os.ReadFile(path); err == nil {
			sendRaw(w, body)
			return
		}
	}
	var cards struct {
		Data             []json.RawMessage `json:"data"`
		LastUpdated      string            `json:"last_updated"`
		ImageURLTemplate string            `json:"imageUrlTemplate"`
	}
	var cycles, packs struct {
		Data []json.RawMessage `json:"data"`
	}
	for url, dst := range map[string]any{nrdb + "cards": &cards, nrdb + "cycles": &cycles, nrdb + "packs": &packs} {
		if err := fetchJSON(url, dst); err != nil {
			sendError(w, 502, "Could not load NetrunnerDB data: %v", err)
			return
		}
	}
	body, _ := json.Marshal(map[string]any{
		"fetched":          time.Now().UTC().Format(time.RFC3339),
		"lastUpdated":      cards.LastUpdated,
		"imageUrlTemplate": cards.ImageURLTemplate,
		"cycles":           cycles.Data,
		"packs":            packs.Data,
		"cards":            cards.Data,
	})
	if err := writeAtomic(path, body); err != nil {
		log.Printf("could not cache NetrunnerDB data: %v", err)
	}
	// A new cycle brings a new set symbol.
	if _, _, err := loadIcons(true); err != nil {
		log.Printf("could not refresh set icons: %v", err)
	}
	sendRaw(w, body)
}

var (
	iconsMu sync.Mutex
	iconRe  = regexp.MustCompile(`\.icon-([a-z0-9-]+):before\s*\{\s*content:\s*"(\\[0-9a-fA-F]+)"`)
)

func fetchBytes(url string) ([]byte, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "netrunner-collection/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// loadIcons returns NetrunnerDB's icon font (a symbol per cycle, plus faction and game glyphs) and a stylesheet
// with an .ic-<cycle code> class per symbol, cached in data/icons/.
func loadIcons(refresh bool) (css, font []byte, err error) {
	iconsMu.Lock()
	defer iconsMu.Unlock()
	cssPath, fontPath := filepath.Join(dataDir, "icons", "icons.css"), filepath.Join(dataDir, "icons", "netrunner.woff")
	if !refresh {
		css, err1 := os.ReadFile(cssPath)
		font, err2 := os.ReadFile(fontPath)
		if err1 == nil && err2 == nil {
			return css, font, nil
		}
	}
	src, err := fetchBytes("https://netrunnerdb.com/netrunnerfont.css")
	if err != nil {
		return nil, nil, err
	}
	if font, err = fetchBytes("https://netrunnerdb.com/fonts/netrunner.woff"); err != nil {
		return nil, nil, err
	}
	var b strings.Builder
	b.WriteString("@font-face { font-family: 'nrdb-icons'; src: url('/api/icons.woff') format('woff'); font-display: block; }\n")
	for _, m := range iconRe.FindAllStringSubmatch(string(src), -1) {
		fmt.Fprintf(&b, ".ic-%s::before { content: \"%s\"; }\n", m[1], m[2])
	}
	css = []byte(b.String())
	if err := writeAtomic(cssPath, css); err != nil {
		log.Printf("could not cache set icons: %v", err)
	}
	writeAtomic(fontPath, font)
	return css, font, nil
}

func getIcons(wantFont bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		css, font, err := loadIcons(false)
		if err != nil {
			sendError(w, 502, "Could not load set icons: %v", err)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		if wantFont {
			w.Header().Set("Content-Type", "font/woff")
			w.Write(font)
			return
		}
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Write(css)
	}
}

// getDecklist proxies a NetrunnerDB published decklist (id or uuid) or shared private deck.
func getDecklist(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !idRe.MatchString(id) {
			sendError(w, 400, "Bad deck id")
			return
		}
		var resp json.RawMessage
		if err := fetchJSON(nrdb+kind+"/"+id, &resp); err != nil {
			sendError(w, 502, "NetrunnerDB lookup failed: %v", err)
			return
		}
		sendRaw(w, resp)
	}
}
