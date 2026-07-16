package game

import "time"

type WeaponID string

const (
	WeaponRifle  WeaponID = "rifle"
	WeaponPistol WeaponID = "pistol"
	WeaponSniper WeaponID = "sniper"
)

type Weapon struct {
	ID         WeaponID
	Name       string
	MagSize    int
	ReserveMax int
	Damage     float64
	FireRate   time.Duration
	Reload     time.Duration
	Auto       bool
	Spread     float64
	Range      float64
	ADS        bool
}

var Weapons = map[WeaponID]Weapon{
	WeaponRifle: {
		ID: WeaponRifle, Name: "步枪",
		MagSize: 30, ReserveMax: 90, Damage: 22,
		FireRate: 100 * time.Millisecond, Reload: 1600 * time.Millisecond,
		Auto: true, Spread: 0.012, Range: 70,
	},
	WeaponPistol: {
		ID: WeaponPistol, Name: "手枪",
		MagSize: 12, ReserveMax: 72, Damage: 18,
		FireRate: 160 * time.Millisecond, Reload: 1000 * time.Millisecond,
		Auto: false, Spread: 0.02, Range: 45,
	},
	WeaponSniper: {
		ID: WeaponSniper, Name: "狙击枪",
		MagSize: 5, ReserveMax: 25, Damage: 95,
		FireRate: 1050 * time.Millisecond, Reload: 2400 * time.Millisecond,
		Auto: false, Spread: 0.002, Range: 120, ADS: true,
	},
}

func (id WeaponID) Valid() bool {
	_, ok := Weapons[id]
	return ok
}
