// Command appicon draws the app's home-screen icons (two overlapping cards in the app's colours) and writes them
// to static/icons/. The files are committed; re-run it only to change the design:
//
//	go run ./tools/appicon
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

var (
	bg     = color.NRGBA{0x0f, 0x12, 0x18, 0xff} // --bg
	panel  = color.NRGBA{0x2c, 0x32, 0x40, 0xff} // --line
	accent = color.NRGBA{0x29, 0xc4, 0xa9, 0xff} // --accent
)

// A shape is a signed distance function over the unit square: negative inside.
type shape struct {
	fill color.NRGBA
	sdf  func(x, y float64) float64
}

// card is a rounded rectangle centred at (cx, cy), rotated by deg degrees.
func card(cx, cy, w, h, r, deg float64) func(x, y float64) float64 {
	s, c := math.Sincos(-deg * math.Pi / 180)
	return func(x, y float64) float64 {
		dx, dy := x-cx, y-cy
		px, py := math.Abs(dx*c-dy*s)-w/2+r, math.Abs(dx*s+dy*c)-h/2+r
		return math.Hypot(math.Max(px, 0), math.Max(py, 0)) + math.Min(math.Max(px, py), 0) - r
	}
}

// design returns the shapes, scaled by k around the centre (maskable icons keep to the middle 80%).
func design(k float64) []shape {
	at := func(f func(x, y float64) float64) func(x, y float64) float64 {
		return func(x, y float64) float64 { return f(.5+(x-.5)/k, .5+(y-.5)/k) * k }
	}
	back := card(.42, .5, .38, .53, .045, -12)
	front := card(.58, .5, .38, .53, .045, 8)
	return []shape{
		{panel, at(back)},
		{bg, at(func(x, y float64) float64 { return front(x, y) - .025 })}, // gap between the cards
		{accent, at(front)},
		{bg, at(card(.58, .5, .13, .13, .01, 53))}, // a diamond on the front card
	}
}

// draw renders the shapes at size px with 4×4 supersampling. rounded leaves transparent corners.
func draw(size int, k float64, rounded bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	shapes := design(k)
	tile := card(.5, .5, 1, 1, .19, 0)
	const ss = 4
	for py := 0; py < size; py++ {
		for px := 0; px < size; px++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					x, y := (float64(px)+(float64(sx)+.5)/ss)/float64(size), (float64(py)+(float64(sy)+.5)/ss)/float64(size)
					if rounded && tile(x, y) > 0 {
						continue
					}
					c := bg
					for _, s := range shapes {
						if s.sdf(x, y) < 0 {
							c = s.fill
						}
					}
					r, g, b, a = r+float64(c.R), g+float64(c.G), b+float64(c.B), a+1
				}
			}
			if a > 0 {
				img.SetNRGBA(px, py, color.NRGBA{uint8(r / a), uint8(g / a), uint8(b / a), uint8(a / ss / ss * 255)})
			}
		}
	}
	return img
}

func main() {
	out := flag.String("out", filepath.Join("static", "icons"), "directory to write the icons to")
	flag.Parse()
	files := []struct {
		name    string
		size    int
		k       float64
		rounded bool
	}{
		{"icon-192.png", 192, 1, true},
		{"icon-512.png", 512, 1, true},
		{"icon-maskable-512.png", 512, .78, false},
		{"apple-touch-icon.png", 180, .9, false}, // iOS rounds the corners itself
	}
	for _, f := range files {
		w, err := os.Create(filepath.Join(*out, f.name))
		if err != nil {
			log.Fatal(err)
		}
		if err := png.Encode(w, draw(f.size, f.k, f.rounded)); err != nil {
			log.Fatal(err)
		}
		w.Close()
		fmt.Println("wrote", f.name)
	}
}
