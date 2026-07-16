package game

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
)

var wsKeyGUID = []byte("258EAFA5-E914-47DA-95CA-C5AB0DC85B11")

// Conn is a minimal text-frame WebSocket connection (stdlib only).
type Conn struct {
	conn net.Conn
	bufr *bufio.Reader
	bufw *bufio.Writer
}

func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return nil, errors.New("not websocket")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("hijack unsupported")
	}
	conn, bufrw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}

	sum := sha1.Sum(append([]byte(key), wsKeyGUID...))
	accept := base64.StdEncoding.EncodeToString(sum[:])
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := bufrw.WriteString(resp); err != nil {
		conn.Close()
		return nil, err
	}
	if err := bufrw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}

	return &Conn{
		conn: conn,
		bufr: bufrw.Reader,
		bufw: bufrw.Writer,
	}, nil
}

func (c *Conn) Close() error {
	return c.conn.Close()
}

func (c *Conn) WriteText(data []byte) error {
	header := make([]byte, 2)
	header[0] = 0x81 // FIN + text
	n := len(data)
	var ext []byte
	if n < 126 {
		header[1] = byte(n)
	} else if n <= 65535 {
		header[1] = 126
		ext = make([]byte, 2)
		binary.BigEndian.PutUint16(ext, uint16(n))
	} else {
		header[1] = 127
		ext = make([]byte, 8)
		binary.BigEndian.PutUint64(ext, uint64(n))
	}
	if _, err := c.bufw.Write(header); err != nil {
		return err
	}
	if len(ext) > 0 {
		if _, err := c.bufw.Write(ext); err != nil {
			return err
		}
	}
	if _, err := c.bufw.Write(data); err != nil {
		return err
	}
	return c.bufw.Flush()
}

func (c *Conn) ReadText() ([]byte, error) {
	for {
		b0, err := c.bufr.ReadByte()
		if err != nil {
			return nil, err
		}
		b1, err := c.bufr.ReadByte()
		if err != nil {
			return nil, err
		}
		opcode := b0 & 0x0f
		masked := b1&0x80 != 0
		payloadLen := int(b1 & 0x7f)
		if payloadLen == 126 {
			var ext [2]byte
			if _, err := io.ReadFull(c.bufr, ext[:]); err != nil {
				return nil, err
			}
			payloadLen = int(binary.BigEndian.Uint16(ext[:]))
		} else if payloadLen == 127 {
			var ext [8]byte
			if _, err := io.ReadFull(c.bufr, ext[:]); err != nil {
				return nil, err
			}
			payloadLen = int(binary.BigEndian.Uint64(ext[:]))
		}

		var mask [4]byte
		if masked {
			if _, err := io.ReadFull(c.bufr, mask[:]); err != nil {
				return nil, err
			}
		}
		payload := make([]byte, payloadLen)
		if _, err := io.ReadFull(c.bufr, payload); err != nil {
			return nil, err
		}
		if masked {
			for i := range payload {
				payload[i] ^= mask[i%4]
			}
		}

		switch opcode {
		case 0x1: // text
			return payload, nil
		case 0x8: // close
			return nil, io.EOF
		case 0x9: // ping -> pong
			_ = c.writeControl(0xA, payload)
		case 0xA: // pong
			continue
		default:
			continue
		}
	}
}

func (c *Conn) writeControl(opcode byte, payload []byte) error {
	if len(payload) > 125 {
		payload = payload[:125]
	}
	header := []byte{0x80 | opcode, byte(len(payload))}
	if _, err := c.bufw.Write(header); err != nil {
		return err
	}
	if _, err := c.bufw.Write(payload); err != nil {
		return err
	}
	return c.bufw.Flush()
}
