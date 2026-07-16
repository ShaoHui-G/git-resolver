package game

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type clientMsg struct {
	Type   string  `json:"type"`
	Weapon string  `json:"weapon"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	OX     float64 `json:"ox"`
	OY     float64 `json:"oy"`
	OZ     float64 `json:"oz"`
	DX     float64 `json:"dx"`
	DY     float64 `json:"dy"`
	DZ     float64 `json:"dz"`
	ADS    bool    `json:"ads"`
}

func HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := Upgrade(w, r)
	if err != nil {
		log.Println("ws upgrade:", err)
		http.Error(w, "websocket upgrade failed", http.StatusBadRequest)
		return
	}
	defer conn.Close()

	hello, _ := json.Marshal(map[string]string{"type": "hello"})
	if err := conn.WriteText(hello); err != nil {
		return
	}

	var session *Session
	incoming := make(chan clientMsg, 64)
	readDone := make(chan struct{})

	go func() {
		defer close(readDone)
		for {
			data, err := conn.ReadText()
			if err != nil {
				return
			}
			var msg clientMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}
			select {
			case incoming <- msg:
			default:
			}
		}
	}()

	ticker := time.NewTicker(SnapshotEvery)
	defer ticker.Stop()
	last := time.Now()

	for {
		select {
		case <-readDone:
			return
		case msg := <-incoming:
			switch msg.Type {
			case "start":
				wid := WeaponID(msg.Weapon)
				if !wid.Valid() {
					wid = WeaponRifle
				}
				session = NewSession(wid)
			case "pose":
				if session != nil {
					session.SetPose(msg.X, msg.Y, msg.Z)
				}
			case "shoot":
				if session != nil {
					session.Shoot(msg.OX, msg.OY, msg.OZ, msg.DX, msg.DY, msg.DZ, msg.ADS)
				}
			case "reload":
				if session != nil {
					session.Reload()
				}
			case "switch":
				if session != nil {
					session.SwitchWeapon(WeaponID(msg.Weapon))
				}
			}
		case now := <-ticker.C:
			if session == nil {
				last = now
				continue
			}
			dt := now.Sub(last).Seconds()
			last = now
			if dt > 0.1 {
				dt = 0.1
			}
			alive := session.Tick(dt)
			snap, err := json.Marshal(session.Snapshot())
			if err != nil {
				return
			}
			if err := conn.WriteText(snap); err != nil {
				return
			}
			if !alive {
				kills, wave := session.Stats()
				over, _ := json.Marshal(OverMsg{Type: "over", Kills: kills, Wave: wave})
				_ = conn.WriteText(over)
				session = nil
			}
		}
	}
}
