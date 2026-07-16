import * as THREE from "three";

const canvas = document.getElementById("view");
const hud = document.getElementById("hud");
const crosshair = document.getElementById("crosshair");
const scopeEl = document.getElementById("scope");
const hpBar = document.getElementById("hp-bar");
const hpText = document.getElementById("hp");
const ammoEl = document.getElementById("ammo");
const waveEl = document.getElementById("wave");
const killsEl = document.getElementById("kills");
const damageEl = document.getElementById("damage");
const weaponNameEl = document.getElementById("weapon-name");
const muzzleFlashEl = document.getElementById("muzzle-flash");

const screenStart = document.getElementById("screen-start");
const screenArmory = document.getElementById("screen-armory");
const screenEnd = document.getElementById("screen-end");
const weaponGrid = document.getElementById("weapon-grid");
const btnArmory = document.getElementById("btn-armory");
const btnBack = document.getElementById("btn-back");
const btnDeploy = document.getElementById("btn-deploy");
const btnRetry = document.getElementById("btn-retry");
const btnRearm = document.getElementById("btn-rearm");
const endTitle = document.getElementById("end-title");
const endMsg = document.getElementById("end-msg");

const WEAPON_META = {
  rifle: { name: "步枪", auto: true, ads: false, zoomFov: 75, recoil: 0.018 },
  pistol: { name: "手枪", auto: false, ads: false, zoomFov: 75, recoil: 0.012 },
  sniper: { name: "狙击枪", auto: false, ads: true, zoomFov: 28, recoil: 0.08 },
};

const PLAYER_SPEED = 8;
const SPRINT_MUL = 1.55;
const PLAYER_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.35;
const MOUSE_SENS = 0.0022;
const JUMP_VEL = 7.8;
const GRAVITY = 22;
const MAP_SIZE = 48;
const HALF = MAP_SIZE / 2;

const state = {
  running: false,
  selectedWeapon: "rifle",
  weaponId: "rifle",
  hp: 100,
  mag: 30,
  reserve: 90,
  kills: 0,
  wave: 1,
  reloading: false,
  yaw: 0,
  pitch: 0,
  aiming: false,
  keys: Object.create(null),
  mouseDown: false,
  colliders: [],
  clock: new THREE.Clock(),
  bob: 0,
  viewKick: 0,
  vy: 0,
  grounded: true,
  ws: null,
  enemyMeshes: new Map(),
  lootMeshes: new Map(),
  poseAcc: 0,
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0xc7daf0, 28, 70);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 140);
camera.position.set(0, PLAYER_HEIGHT, 10);
const weaponRoot = new THREE.Group();
camera.add(weaponRoot);
scene.add(camera);

function makeNoiseTexture(size, c1, c2) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = c1;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.28; i++) {
    g.fillStyle = c2;
    g.fillRect((Math.random() * size) | 0, (Math.random() * size) | 0, 1 + (Math.random() * 2) | 0, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const floorTex = makeNoiseTexture(256, "#8a9a72", "rgba(40,50,30,0.12)");
floorTex.repeat.set(14, 14);
const wallTex = makeNoiseTexture(256, "#d5c6a8", "rgba(80,60,40,0.1)");
wallTex.repeat.set(2, 1);
const crateTex = makeNoiseTexture(128, "#a87a48", "rgba(40,20,8,0.15)");
const metalTex = makeNoiseTexture(128, "#8b95a3", "rgba(255,255,255,0.08)");

const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.02 });
const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.88, metalness: 0.05 });
const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.82, metalness: 0.04 });
const metalMat = new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.45, metalness: 0.55, color: 0xc0c6ce });
const accentMat = new THREE.MeshStandardMaterial({
  color: 0xff6a1a,
  emissive: 0xff4a00,
  emissiveIntensity: 0.25,
  roughness: 0.55,
});
const trimMat = new THREE.MeshStandardMaterial({ color: 0x5a6570, roughness: 0.7, metalness: 0.25 });

scene.add(new THREE.HemisphereLight(0xdcebff, 0x8a7a55, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
sun.position.set(18, 28, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 70;
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.bias = -0.00025;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.28));

function addCollider(x, z, w, d) {
  state.colliders.push({
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  });
}

function addBox(x, y, z, w, h, d, mat = wallMat, collide = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (collide) addCollider(x, z, w, d);
  return mesh;
}

function buildMap() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // open daytime yard — low perimeter walls, no heavy ceiling
  const t = 1.2;
  const h = 2.8;
  addBox(0, h / 2, -HALF, MAP_SIZE, h, t);
  addBox(0, h / 2, HALF, MAP_SIZE, h, t);
  addBox(-HALF, h / 2, 0, t, h, MAP_SIZE);
  addBox(HALF, h / 2, 0, t, h, MAP_SIZE);

  addBox(0, 1.3, 0, 6, 2.6, 1.3);
  addBox(-2.2, 1.2, 7.5, 1.1, 2.4, 7);
  addBox(8.5, 1.2, -6, 1.1, 2.4, 8);
  addBox(-9, 1.1, -8, 5, 2.2, 1.2);

  addBox(-7, 0.7, -5, 1.6, 1.4, 1.6, crateMat);
  addBox(-5.5, 0.7, -6.5, 1.4, 1.4, 1.4, crateMat);
  addBox(6, 0.7, 7, 1.6, 1.4, 1.6, crateMat);
  addBox(8, 0.65, 5.5, 1.5, 1.3, 1.5, crateMat);
  addBox(4, 0.55, -11, 2.2, 1.1, 1.4, crateMat);

  addBox(-3, 0.55, -3, 3.5, 1.1, 0.45, metalMat);
  addBox(5, 0.55, 3, 0.45, 1.1, 3.2, metalMat);
  addBox(-10, 0.35, 8, 1.6, 0.7, 1.6, accentMat);
  addBox(10, 0.35, -10, 1.6, 0.7, 1.6, accentMat);

  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -14], [0, 14]]) {
    addBox(x, 1.8, z, 1, 3.6, 1, metalMat);
    addBox(x, 0.12, z, 1.5, 0.24, 1.5, trimMat, false);
  }

  // simple sky sun disc
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0 })
  );
  sunMesh.position.set(40, 36, -20);
  scene.add(sunMesh);
}

buildMap();

/* ========================= Guns (viewmodel only) ========================= */
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2f3744, roughness: 0.4, metalness: 0.75 });
const gunDark = new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.55, metalness: 0.4 });
const gunAccent = new THREE.MeshStandardMaterial({
  color: 0xff6a1a, emissive: 0xff4a00, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3,
});
const gunWood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85, metalness: 0.05 });

function part(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function buildRifleModel() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.12, 0.16, 0.55), gunMetal, 0, -0.02, -0.1));
  g.add(part(new THREE.BoxGeometry(0.09, 0.1, 0.7), gunDark, 0, 0.02, -0.55));
  const barrel = part(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 8), gunMetal, 0, 0.02, -0.95);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  g.add(part(new THREE.BoxGeometry(0.08, 0.18, 0.08), gunDark, 0, -0.16, 0.05));
  g.add(part(new THREE.BoxGeometry(0.07, 0.12, 0.22), gunWood, 0, -0.12, 0.22));
  g.add(part(new THREE.BoxGeometry(0.04, 0.04, 0.08), gunAccent, 0.06, 0.04, -0.05));
  return g;
}

function buildPistolModel() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.08, 0.14, 0.28), gunMetal, 0, 0, -0.05));
  g.add(part(new THREE.BoxGeometry(0.06, 0.08, 0.18), gunDark, 0, 0.02, -0.22));
  g.add(part(new THREE.BoxGeometry(0.07, 0.2, 0.09), gunDark, 0, -0.14, 0.04));
  g.add(part(new THREE.BoxGeometry(0.03, 0.03, 0.05), gunAccent, 0.045, 0.02, -0.02));
  return g;
}

function buildSniperModel() {
  const g = new THREE.Group();
  g.add(part(new THREE.BoxGeometry(0.1, 0.12, 0.7), gunMetal, 0, -0.02, -0.15));
  const barrel = part(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 8), gunDark, 0, 0.01, -0.85);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  const scope = part(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10), gunDark, 0, 0.1, -0.2);
  scope.rotation.x = Math.PI / 2;
  g.add(scope);
  g.add(part(new THREE.BoxGeometry(0.08, 0.16, 0.08), gunDark, 0, -0.16, 0.1));
  g.add(part(new THREE.BoxGeometry(0.09, 0.1, 0.28), gunWood, 0, -0.1, 0.28));
  g.add(part(new THREE.BoxGeometry(0.035, 0.035, 0.06), gunAccent, 0.055, 0.03, 0));
  return g;
}

const gunModels = { rifle: buildRifleModel(), pistol: buildPistolModel(), sniper: buildSniperModel() };
const gunOffsets = {
  rifle: { pos: [0.28, -0.28, -0.55], rot: [0.05, 0.12, 0.04] },
  pistol: { pos: [0.26, -0.24, -0.45], rot: [0.02, 0.1, 0.02] },
  sniper: { pos: [0.3, -0.3, -0.65], rot: [0.06, 0.1, 0.03] },
};
let activeGun = null;

function equipWeaponVisual(id) {
  while (weaponRoot.children.length) weaponRoot.remove(weaponRoot.children[0]);
  activeGun = gunModels[id];
  const off = gunOffsets[id];
  activeGun.position.set(...off.pos);
  activeGun.rotation.set(...off.rot);
  activeGun.visible = true;
  weaponRoot.add(activeGun);
  state.weaponId = id;
  weaponNameEl.textContent = WEAPON_META[id].name;
}

equipWeaponVisual("rifle");

/* ========================= Enemies render ========================= */
const enemyGeo = new THREE.CapsuleGeometry(0.35, 0.9, 4, 8);
const enemyMat = new THREE.MeshStandardMaterial({
  color: 0xb83232, roughness: 0.55, metalness: 0.15, emissive: 0x3a0808, emissiveIntensity: 0.2,
});
const headGeo = new THREE.SphereGeometry(0.28, 10, 10);
const headMat = new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.7 });

function makeEnemyMesh() {
  const body = new THREE.Mesh(enemyGeo, enemyMat);
  body.castShadow = true;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.85, 0);
  body.add(head);
  return body;
}

function syncEnemies(list) {
  const seen = new Set();
  for (const e of list) {
    seen.add(e.id);
    let mesh = state.enemyMeshes.get(e.id);
    if (!mesh) {
      mesh = makeEnemyMesh();
      scene.add(mesh);
      state.enemyMeshes.set(e.id, mesh);
    }
    mesh.position.set(e.x, e.y, e.z);
    mesh.lookAt(camera.position.x, e.y, camera.position.z);
  }
  for (const [id, mesh] of state.enemyMeshes) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      state.enemyMeshes.delete(id);
    }
  }
}

function clearWorldActors() {
  for (const [, mesh] of state.enemyMeshes) scene.remove(mesh);
  state.enemyMeshes.clear();
  for (const [, mesh] of state.lootMeshes) scene.remove(mesh);
  state.lootMeshes.clear();
}

/* ========================= Collision / movement ========================= */
function blocked(x, z, radius = PLAYER_RADIUS) {
  if (Math.abs(x) > HALF - 0.9 - radius || Math.abs(z) > HALF - 0.9 - radius) return true;
  for (const c of state.colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function tryMove(dx, dz) {
  const nx = camera.position.x + dx;
  const nz = camera.position.z + dz;
  if (!blocked(nx, camera.position.z)) camera.position.x = nx;
  if (!blocked(camera.position.x, nz)) camera.position.z = nz;
}

/* ========================= UI / WS ========================= */
function showScreen(el) {
  screenStart.classList.add("hidden");
  screenArmory.classList.add("hidden");
  screenEnd.classList.add("hidden");
  el.classList.remove("hidden");
}

function updateHud() {
  hpBar.style.transform = `scaleX(${Math.max(0, state.hp) / 100})`;
  hpText.textContent = String(Math.ceil(Math.max(0, state.hp)));
  waveEl.textContent = String(state.wave);
  killsEl.textContent = String(state.kills);
  weaponNameEl.textContent = WEAPON_META[state.weaponId]?.name || state.weaponId;
  if (state.reloading) {
    ammoEl.classList.add("reloading");
    ammoEl.innerHTML = "换弹中";
  } else {
    ammoEl.classList.remove("reloading");
    ammoEl.innerHTML = `${state.mag} <small>/ ${state.reserve}</small>`;
  }
}

function wsURL() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(obj));
  }
}

function closeWS() {
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
}

function handleEvents(events) {
  for (const ev of events || []) {
    if (ev.kind === "muzzle") {
      state.viewKick = Math.min(0.12, state.viewKick + (WEAPON_META[state.weaponId]?.recoil || 0.02));
      state.pitch = Math.max(-1.2, state.pitch - (WEAPON_META[state.weaponId]?.recoil || 0.02) * 0.65);
      muzzleFlashEl.classList.add("on");
      setTimeout(() => muzzleFlashEl.classList.remove("on"), 45);
    } else if (ev.kind === "hit") {
      crosshair.classList.add("hit");
      setTimeout(() => crosshair.classList.remove("hit"), 80);
      flashHit(ev.x, ev.y, ev.z);
    } else if (ev.kind === "damage") {
      damageEl.classList.add("on");
      setTimeout(() => damageEl.classList.remove("on"), 180);
    } else if (ev.kind === "loot") {
      spawnLootVisual(ev.x, ev.z);
    } else if (ev.kind === "kill") {
      // mesh removed via sync
    }
  }
}

function flashHit(x, y, z) {
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd2a0 })
  );
  spark.position.set(x, y, z);
  scene.add(spark);
  setTimeout(() => scene.remove(spark), 80);
}

function spawnLootVisual(x, z) {
  const key = `${x.toFixed(1)}_${z.toFixed(1)}`;
  if (state.lootMeshes.has(key)) return;
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.28),
    new THREE.MeshStandardMaterial({ color: 0xff9a4a, emissive: 0xff6a1a, emissiveIntensity: 0.4 })
  );
  mesh.position.set(x, 0.45, z);
  scene.add(mesh);
  state.lootMeshes.set(key, mesh);
  setTimeout(() => {
    scene.remove(mesh);
    state.lootMeshes.delete(key);
  }, 18000);
}

function onServerMessage(msg) {
  if (msg.type === "state") {
    state.hp = msg.hp;
    state.mag = msg.mag;
    state.reserve = msg.reserve;
    state.kills = msg.kills;
    state.wave = msg.wave;
    state.reloading = msg.reloading;
    if (msg.weapon && msg.weapon !== state.weaponId) {
      equipWeaponVisual(msg.weapon);
    }
    syncEnemies(msg.enemies || []);
    handleEvents(msg.events);
    updateHud();
  } else if (msg.type === "over") {
    gameOver(msg.kills, msg.wave);
  }
}

function connectAndStart() {
  closeWS();
  clearWorldActors();
  const ws = new WebSocket(wsURL());
  state.ws = ws;
  ws.onopen = () => {
    send({ type: "start", weapon: state.selectedWeapon });
    equipWeaponVisual(state.selectedWeapon);
    state.running = true;
    state.yaw = 0;
    state.pitch = 0;
    state.vy = 0;
    state.grounded = true;
    state.aiming = false;
    state.mouseDown = false;
    camera.position.set(0, PLAYER_HEIGHT, 10);
    camera.fov = 75;
    camera.updateProjectionMatrix();
    screenStart.classList.add("hidden");
    screenArmory.classList.add("hidden");
    screenEnd.classList.add("hidden");
    hud.hidden = false;
    crosshair.hidden = false;
    scopeEl.hidden = true;
    updateHud();
    canvas.requestPointerLock();
  };
  ws.onmessage = (ev) => {
    try {
      onServerMessage(JSON.parse(ev.data));
    } catch (_) {}
  };
  ws.onerror = () => {
    endTitle.textContent = "连接失败";
    endMsg.innerHTML = "无法连接游戏服务器。<br />请用 <code>go run .</code> 启动后访问页面";
    showScreen(screenEnd);
  };
  ws.onclose = () => {
    if (state.running) {
      state.running = false;
      endTitle.textContent = "连接断开";
      endMsg.textContent = "与服务器的连接已断开";
      showScreen(screenEnd);
      hud.hidden = true;
      crosshair.hidden = true;
    }
  };
}

function gameOver(kills, wave) {
  state.running = false;
  state.aiming = false;
  document.exitPointerLock?.();
  hud.hidden = true;
  crosshair.hidden = true;
  scopeEl.hidden = true;
  closeWS();
  endTitle.textContent = "任务失败";
  endMsg.innerHTML = `击杀 ${kills} · 坚持到第 ${wave} 波<br />可更换武器后再次出击`;
  showScreen(screenEnd);
}

function requestShoot() {
  if (!state.running || state.reloading) return;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  send({
    type: "shoot",
    ox: origin.x,
    oy: origin.y,
    oz: origin.z,
    dx: dir.x,
    dy: dir.y,
    dz: dir.z,
    ads: state.aiming,
  });
}

function setAiming(on) {
  const meta = WEAPON_META[state.weaponId];
  if (!state.running || !meta?.ads || state.reloading) {
    state.aiming = false;
    scopeEl.hidden = true;
    camera.fov = 75;
    camera.updateProjectionMatrix();
    if (activeGun) activeGun.visible = true;
    crosshair.hidden = !state.running;
    return;
  }
  state.aiming = on;
  scopeEl.hidden = !on;
  crosshair.hidden = on;
  camera.fov = on ? meta.zoomFov : 75;
  camera.updateProjectionMatrix();
  if (activeGun) activeGun.visible = !on;
}

function switchWeapon(id) {
  if (!WEAPON_META[id]) return;
  state.selectedWeapon = id;
  equipWeaponVisual(id);
  setAiming(false);
  send({ type: "switch", weapon: id });
}

/* ========================= Loop ========================= */
function update(dt) {
  state.viewKick = Math.max(0, state.viewKick - dt * 0.35);
  if (activeGun && !state.aiming) {
    const idle = Math.sin(performance.now() * 0.002) * 0.004;
    const off = gunOffsets[state.weaponId];
    activeGun.position.y = off.pos[1] + idle - state.viewKick * 0.4;
    activeGun.rotation.x = off.rot[0] + state.viewKick;
  }

  if (!state.running) return;

  const meta = WEAPON_META[state.weaponId];
  if (meta?.auto && state.mouseDown) requestShoot();

  const forward = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();
  if (state.keys.w) move.add(forward);
  if (state.keys.s) move.sub(forward);
  if (state.keys.a) move.sub(right);
  if (state.keys.d) move.add(right);

  const moving = move.lengthSq() > 0;
  if (moving) {
    move.normalize();
    const aimSlow = state.aiming ? 0.55 : 1;
    const speed = PLAYER_SPEED * (state.keys.Shift && !state.aiming ? SPRINT_MUL : 1) * aimSlow;
    tryMove(move.x * speed * dt, move.z * speed * dt);
    state.bob += dt * (state.keys.Shift ? 14 : 10);
  }

  // jump / gravity
  if (state.keys[" "] && state.grounded) {
    state.vy = JUMP_VEL;
    state.grounded = false;
  }
  state.vy -= GRAVITY * dt;
  let nextY = camera.position.y + state.vy * dt;
  if (nextY <= PLAYER_HEIGHT) {
    nextY = PLAYER_HEIGHT;
    state.vy = 0;
    state.grounded = true;
  }
  const bobY = moving && state.grounded ? Math.sin(state.bob) * 0.035 : 0;
  camera.position.y = nextY + bobY;

  camera.rotation.order = "YXZ";
  camera.rotation.y = state.yaw;
  camera.rotation.x = state.pitch;

  if (activeGun && moving && !state.aiming) {
    const off = gunOffsets[state.weaponId];
    activeGun.position.x = off.pos[0] + Math.sin(state.bob) * 0.015;
  }

  // loot spin
  for (const [, mesh] of state.lootMeshes) {
    mesh.rotation.y += dt * 2;
    mesh.position.y = 0.45 + Math.sin(performance.now() * 0.004) * 0.1;
  }

  state.poseAcc += dt;
  if (state.poseAcc > 0.05) {
    state.poseAcc = 0;
    send({ type: "pose", x: camera.position.x, y: camera.position.y, z: camera.position.z });
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function loop() {
  const dt = Math.min(0.05, state.clock.getDelta());
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ========================= Input / screens ========================= */
weaponGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".weapon-card");
  if (!card) return;
  weaponGrid.querySelectorAll(".weapon-card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");
  state.selectedWeapon = card.dataset.weapon;
  equipWeaponVisual(state.selectedWeapon);
});

btnArmory.addEventListener("click", () => showScreen(screenArmory));
btnBack.addEventListener("click", () => showScreen(screenStart));
btnDeploy.addEventListener("click", connectAndStart);
btnRetry.addEventListener("click", connectAndStart);
btnRearm.addEventListener("click", () => showScreen(screenArmory));

window.addEventListener("resize", onResize);
window.addEventListener("keydown", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  state.keys[k] = true;
  if (e.code === "Space") state.keys[" "] = true;
  if (!state.running) return;
  if (e.key === "r" || e.key === "R") {
    e.preventDefault();
    send({ type: "reload" });
  }
  if (e.key === "1") switchWeapon("rifle");
  if (e.key === "2") switchWeapon("pistol");
  if (e.key === "3") switchWeapon("sniper");
  if (e.code === "Space" || e.key === "Tab") e.preventDefault();
});
window.addEventListener("keyup", (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  state.keys[k] = false;
  if (e.code === "Space") state.keys[" "] = false;
});

document.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas || !state.running) return;
  const sens = state.aiming ? MOUSE_SENS * 0.45 : MOUSE_SENS;
  state.yaw -= e.movementX * sens;
  state.pitch -= e.movementY * sens;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch));
});

document.addEventListener("mousedown", (e) => {
  if (!state.running) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
    return;
  }
  if (e.button === 0) {
    state.mouseDown = true;
    requestShoot();
  }
  if (e.button === 2) {
    e.preventDefault();
    setAiming(true);
  }
});
document.addEventListener("mouseup", (e) => {
  if (e.button === 0) state.mouseDown = false;
  if (e.button === 2) setAiming(false);
});
document.addEventListener("contextmenu", (e) => e.preventDefault());

const hint = document.querySelector(".hint");
if (hint) hint.textContent = "空格跳跃 · R 换弹 · 右键开镜 · 1/2/3 切枪";

updateHud();
loop();
