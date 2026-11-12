// Netrunner collection manager: a local server for the browser UI in static/.
//
//	netrunner.exe              serve on http://localhost:8765 and open the browser
//	netrunner.exe -port 9000   different port
//	netrunner.exe -no-open     don't open a browser tab
//	netrunner.exe -dev         serve static/ from disk instead of the embedded copy
//	netrunner.exe -lan         also reachable from other devices on your Wi-Fi (phone, tablet)
//
// The UI keeps the collection in the browser (IndexedDB) and talks to NetrunnerDB directly, so this only serves
// static files. The /api endpoints of the earlier version, which read and wrote data/collection.json, are gone:
// they had no access control, so with -lan any device on the network could read or overwrite the collection.
// An old data/collection.json can be loaded in the app with Restore from backup.
package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

//go:embed static
var embedded embed.FS

func main() {
	port := flag.Int("port", 8765, "port to listen on")
	noOpen := flag.Bool("no-open", false, "don't open a browser tab")
	dev := flag.Bool("dev", false, "serve static/ from disk (for editing the UI)")
	lan := flag.Bool("lan", false, "also listen on your local network, e.g. to use it from a phone")
	flag.Parse()

	var static http.FileSystem
	if *dev {
		static = http.Dir("static")
	} else {
		sub, _ := fs.Sub(embedded, "static")
		static = http.FS(sub)
	}

	files := http.FileServer(static)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	if *lan {
		addr = fmt.Sprintf("0.0.0.0:%d", *port)
	}
	url := fmt.Sprintf("http://localhost:%d/", *port)
	fmt.Printf("Netrunner collection: %s  (Ctrl+C to stop)\n", url)
	if *lan {
		for _, ip := range lanIPs() {
			fmt.Printf("  on your phone (same Wi-Fi): http://%s:%d/\n", ip, *port)
		}
	}
	if !*noOpen {
		go func() { time.Sleep(500 * time.Millisecond); openBrowser(url) }()
	}
	log.Fatal(http.ListenAndServe(addr, handler))
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
