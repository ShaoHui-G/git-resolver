package game

import (
	"math"
	"math/rand"
	"sync"
	"time"
)

const (
	MapHalf       = 23.0
	EnemyRadius   = 0.55
	EnemyHitY     = 1.05
	TickRate      = 20
	SnapshotEvery = time.Second / TickRate
)

type Enemy struct {
	ID     int     `json:"id"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	HP     float64 `json:"-"`
	Speed  float64 `json:"-"`
	FireCd float64 `json:"-"`
}

type Event struct {
	Kind string  `json:"kind"`
	X    float64 `json:"x,omitempty"`
	Y    float64 `json:"y,omitempty"`
	Z    float64 `json:"z,omitempty"`
}

type StateMsg struct {
	Type      string  `json:"type"`
	HP        int     `json:"hp"`
	Mag       int     `json:"mag"`
	Reserve   int     `json:"reserve"`
	Kills     int     `json:"kills"`
	Wave      int     `json:"wave"`
	Reloading bool    `json:"reloading"`
	Weapon    string  `json:"weapon"`
	Alive     bool    `json:"alive"`
	Enemies   []Enemy `json:"enemies"`
	Events    []Event `json:"events"`
}

type OverMsg struct {
	Type  string `json:"type"`
	Kills int    `json:"kills"`
	Wave  int    `json:"wave"`
}

type loot struct {
	x, z float64
	life float64
}

type Session struct {
	mu sync.Mutex

	alive                 bool
	hp                    float64
	mag                   int
	reserve               int
	kills                 int
	wave                  int
	weapon                Weapon
	reloading             bool
	reloadAt              time.Time
	lastShot              time.Time
	invuln                float64
	spawnLeft             int
	spawnTimer            float64
	playerX, playerY, playerZ float64
	enemies               []*Enemy
	nextEnemyID           int
	events                []Event
	pendingLoot           []loot
	rng                   *rand.Rand
}

func NewSession(weaponID WeaponID) *Session {
	w, ok := Weapons[weaponID]
	if !ok {
		w = Weapons[WeaponRifle]
	}
	s := &Session{
		alive:   true,
		hp:      100,
		mag:     w.MagSize,
		reserve: w.ReserveMax,
		wave:    1,
		weapon:  w,
		playerY: 1.6,
		playerZ: 10,
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
		enemies: make([]*Enemy, 0, 16),
	}
	s.startWave()
	return s
}

func (s *Session) startWave() {
	s.spawnLeft = 3 + s.wave*2
	s.spawnTimer = 0.4
}

func (s *Session) SetPose(x, y, z float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.alive {
		return
	}
	s.playerX, s.playerY, s.playerZ = x, y, z
}

func (s *Session) SwitchWeapon(id WeaponID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := Weapons[id]
	if !ok || !s.alive {
		return
	}
	s.weapon = w
	s.mag = w.MagSize
	s.reserve = w.ReserveMax
	s.reloading = false
}

func (s *Session) Reload() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.alive || s.reloading || s.reserve <= 0 || s.mag >= s.weapon.MagSize {
		return
	}
	s.reloading = true
	s.reloadAt = time.Now().Add(s.weapon.Reload)
}

func (s *Session) Shoot(ox, oy, oz, dx, dy, dz float64, ads bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.alive || s.reloading {
		return
	}
	now := time.Now()
	if now.Sub(s.lastShot) < s.weapon.FireRate {
		return
	}
	if s.mag <= 0 {
		s.beginReloadLocked(now)
		return
	}

	s.mag--
	s.lastShot = now
	s.events = append(s.events, Event{Kind: "muzzle"})

	length := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if length < 1e-6 {
		return
	}
	dx, dy, dz = dx/length, dy/length, dz/length

	spread := s.weapon.Spread
	if ads && s.weapon.ADS {
		spread *= 0.15
	}
	dx += (s.rng.Float64() - 0.5) * spread
	dy += (s.rng.Float64() - 0.5) * spread
	dz += (s.rng.Float64() - 0.5) * spread
	length = math.Sqrt(dx*dx + dy*dy + dz*dz)
	dx, dy, dz = dx/length, dy/length, dz/length

	hitIdx := -1
	hitDist := s.weapon.Range
	for i, e := range s.enemies {
		t := raySphere(ox, oy, oz, dx, dy, dz, e.X, e.Y, e.Z, EnemyRadius)
		if t > 0 && t < hitDist {
			hitDist = t
			hitIdx = i
		}
	}

	if hitIdx >= 0 {
		e := s.enemies[hitIdx]
		e.HP -= s.weapon.Damage
		s.events = append(s.events, Event{Kind: "hit", X: e.X, Y: e.Y + 0.8, Z: e.Z})
		if e.HP <= 0 {
			s.events = append(s.events, Event{Kind: "kill", X: e.X, Y: e.Y, Z: e.Z})
			s.kills++
			if s.rng.Float64() < 0.35 {
				s.pendingLoot = append(s.pendingLoot, loot{x: e.X, z: e.Z, life: 18})
				s.events = append(s.events, Event{Kind: "loot", X: e.X, Y: 0.45, Z: e.Z})
			}
			s.enemies = append(s.enemies[:hitIdx], s.enemies[hitIdx+1:]...)
		}
	}

	if s.mag <= 0 {
		s.beginReloadLocked(now)
	}
}

func (s *Session) beginReloadLocked(now time.Time) {
	if s.reloading || s.reserve <= 0 || s.mag >= s.weapon.MagSize {
		return
	}
	s.reloading = true
	s.reloadAt = now.Add(s.weapon.Reload)
}

func (s *Session) grantLootLocked() {
	if s.rng.Float64() < 0.5 {
		s.reserve = minInt(s.weapon.ReserveMax, s.reserve+s.weapon.MagSize)
	} else {
		s.hp = math.Min(100, s.hp+30)
	}
}

func raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r float64) float64 {
	ocx, ocy, ocz := ox-cx, oy-cy, oz-cz
	b := ocx*dx + ocy*dy + ocz*dz
	c := ocx*ocx + ocy*ocy + ocz*ocz - r*r
	disc := b*b - c
	if disc < 0 {
		return -1
	}
	sq := math.Sqrt(disc)
	t := -b - sq
	if t < 0 {
		t = -b + sq
	}
	if t < 0 {
		return -1
	}
	return t
}

func (s *Session) Tick(dt float64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.alive {
		return false
	}

	now := time.Now()
	if s.reloading && !now.Before(s.reloadAt) {
		need := s.weapon.MagSize - s.mag
		take := need
		if take > s.reserve {
			take = s.reserve
		}
		s.mag += take
		s.reserve -= take
		s.reloading = false
	}

	if s.invuln > 0 {
		s.invuln -= dt
	}

	aliveLoot := s.pendingLoot[:0]
	for _, p := range s.pendingLoot {
		p.life -= dt
		if p.life <= 0 {
			continue
		}
		dx := s.playerX - p.x
		dz := s.playerZ - p.z
		if dx*dx+dz*dz < 1.2 {
			s.grantLootLocked()
			continue
		}
		aliveLoot = append(aliveLoot, p)
	}
	s.pendingLoot = aliveLoot

	s.spawnTimer -= dt
	if s.spawnLeft > 0 && s.spawnTimer <= 0 {
		s.spawnEnemyLocked()
		s.spawnLeft--
		s.spawnTimer = math.Max(0.4, 1.2-float64(s.wave)*0.05)
	}

	for _, e := range s.enemies {
		dx := s.playerX - e.X
		dz := s.playerZ - e.Z
		dist := math.Hypot(dx, dz)
		if dist > 3.2 && dist > 1e-3 {
			e.X += dx / dist * e.Speed * dt
			e.Z += dz / dist * e.Speed * dt
			e.X = clamp(e.X, -MapHalf+2, MapHalf-2)
			e.Z = clamp(e.Z, -MapHalf+2, MapHalf-2)
		}
		e.FireCd -= dt
		if e.FireCd <= 0 && dist < 24 {
			e.FireCd = math.Max(0.55, 1.4-float64(s.wave)*0.05)
			if s.invuln <= 0 {
				s.hp -= 8 + float64(s.wave)
				s.invuln = 0.4
				s.events = append(s.events, Event{Kind: "damage"})
				if s.hp <= 0 {
					s.hp = 0
					s.alive = false
					return false
				}
			}
		}
	}

	if s.spawnLeft <= 0 && len(s.enemies) == 0 {
		s.wave++
		s.reserve = minInt(s.weapon.ReserveMax, s.reserve+s.weapon.MagSize)
		s.hp = math.Min(100, s.hp+20)
		s.startWave()
	}
	return true
}

func (s *Session) spawnEnemyLocked() {
	side := s.rng.Intn(4)
	m := MapHalf - 3
	var x, z float64
	switch side {
	case 0:
		x = s.rng.Float64()*2*m - m
		z = -m
	case 1:
		x = s.rng.Float64()*2*m - m
		z = m
	case 2:
		x = -m
		z = s.rng.Float64()*2*m - m
	default:
		x = m
		z = s.rng.Float64()*2*m - m
	}
	s.nextEnemyID++
	s.enemies = append(s.enemies, &Enemy{
		ID:     s.nextEnemyID,
		X:      x,
		Y:      EnemyHitY,
		Z:      z,
		HP:     40 + float64(s.wave)*12,
		Speed:  2.2 + float64(s.wave)*0.15,
		FireCd: 0.8 + s.rng.Float64(),
	})
}

func (s *Session) Snapshot() StateMsg {
	s.mu.Lock()
	defer s.mu.Unlock()
	enemies := make([]Enemy, 0, len(s.enemies))
	for _, e := range s.enemies {
		enemies = append(enemies, Enemy{ID: e.ID, X: e.X, Y: e.Y, Z: e.Z})
	}
	ev := s.events
	s.events = nil
	return StateMsg{
		Type:      "state",
		HP:        int(math.Ceil(s.hp)),
		Mag:       s.mag,
		Reserve:   s.reserve,
		Kills:     s.kills,
		Wave:      s.wave,
		Reloading: s.reloading,
		Weapon:    string(s.weapon.ID),
		Alive:     s.alive,
		Enemies:   enemies,
		Events:    ev,
	}
}

func (s *Session) Stats() (kills, wave int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.kills, s.wave
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
