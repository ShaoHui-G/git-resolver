package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"git-resolver/internal/game"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	webDir := filepath.Join(".", "web")
	fs := http.FileServer(http.Dir(webDir))

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", game.HandleWS)
	mux.Handle("/", fs)

	addr := ":" + port
	fmt.Printf("穿越火线: http://localhost:%s/\n", port)
	fmt.Printf("WebSocket: ws://localhost:%s/ws\n", port)
	log.Fatal(http.ListenAndServe(addr, mux))
}
