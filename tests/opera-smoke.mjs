import { mkdir, writeFile } from 'node:fs/promises';

const endpoint = process.env.OPERA_CDP_ENDPOINT || 'http://127.0.0.1:9228';
const deadline = Date.now() + 15000;
let version;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${endpoint}/json/version`);
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!version) throw new Error('Opera debugging endpoint did not become ready');

const testUrl = process.env.OPERA_TEST_URL || 'http://127.0.0.1:8778/index.html?lite=1&test=1';
const pageResponse = await fetch(`${endpoint}/json/new?${encodeURIComponent(testUrl)}`, { method: 'PUT' });
let page, reuseStartupTab = false;
if (pageResponse.ok) page = await pageResponse.json();
else {
  const targetsResponse = await fetch(`${endpoint}/json/list`);
  const targets = targetsResponse.ok ? await targetsResponse.json() : [];
  page = targets.find(target => target.type === 'page');
  reuseStartupTab = true;
}
if (!page) throw new Error(`Could not open or reuse an Opera test page: ${pageResponse.status}`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const runtimeExceptions = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') runtimeExceptions.push(message.params?.exceptionDetails?.text || 'Runtime exception');
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});
socket.addEventListener('close', () => {
  for (const { reject } of pending.values()) reject(new Error('Opera closed the debugging target'));
  pending.clear();
});
function command(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await command('Page.enable');
await command('Runtime.enable');
if (reuseStartupTab) await command('Page.navigate', { url: testUrl });
const fastFallbackTest = process.env.OPERA_SCENARIO_TEST === '1' || process.env.OPERA_REPLAY_PARTICLE_TEST === '1' || process.env.OPERA_CRASH_GARAGE_TEST === '1' || process.env.OPERA_LANE_TURN_TEST === '1' || process.env.OPERA_SPEED_STEER_TEST === '1' || process.env.OPERA_HORN_REACTION_TEST === '1' || process.env.OPERA_RAILWAY_TEST === '1' || process.env.OPERA_SYSTEMS_TEST === '1' || process.env.OPERA_EXIT_TRANSITION_TEST === '1' || process.env.OPERA_ROUNDABOUT_YIELD_TEST === '1' || process.env.OPERA_ARRIVAL_MENU_TEST === '1' || process.env.OPERA_MUSIC_TEST === '1' || process.env.OPERA_MODE_SELECT_TEST === '1';
const loadDeadline = Date.now() + (fastFallbackTest ? 5000 : 40000);
while (Date.now() < loadDeadline) {
  const readiness = await command('Runtime.evaluate', { expression: `!!document.querySelector('.mode-choice') || !!(document.querySelector('#start') && !document.querySelector('#start').disabled)`, returnByValue: true });
  if (readiness.result.value) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (process.env.OPERA_WAIT_DETAILED === '1') await new Promise(resolve => setTimeout(resolve, 5000));

if (process.env.OPERA_MUSIC_TEST === '1') {
  const evaluation = await command('Runtime.evaluate', { expression: 'window.__carDodgeTest?.auditSoundtracks()', awaitPromise: true, returnByValue: true });
  if (evaluation.exceptionDetails) throw new Error(`Soundtrack browser exception: ${JSON.stringify(evaluation.exceptionDetails)}`);
  const tracks = evaluation.result.value || {}, entries = Object.entries(tracks);
  if (entries.length !== 15 || entries.some(([, track]) => !track.title || track.events < 1 || track.duration <= 2)) throw new Error(`Soundtrack pack failed validation: ${JSON.stringify(tracks)}`);
  if (runtimeExceptions.length) throw new Error(`Soundtrack uncaught errors: ${JSON.stringify(runtimeExceptions)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, soundtrackPack: 'passed', tracks }, null, 2));
  process.exit(0);
}

if (process.env.OPERA_LAMP_AUDIT === '1') {
  const outputDir = new URL('../.lamp-audit/', import.meta.url);
  await mkdir(outputDir, { recursive: true });
  const ids = process.env.OPERA_LAMP_IDS?.split(',').filter(Boolean) || ['sedan', 'sedan-sports', 'hatchback', 'suv', 'suv-luxury', 'taxi', 'police', 'ambulance', 'van', 'delivery', 'truck', 'garbage-truck', 'firetruck', 'bus', 'school-bus', 'player-real'];
  if (ids.includes('player-real')) {
    const detailedDeadline = Date.now() + Number(process.env.OPERA_DETAILED_WAIT_MS || 20000);
    while (Date.now() < detailedDeadline) {
      const loaded = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.lampAudit()?.some(vehicle => vehicle.id === 'player-real')`, returnByValue: true });
      if (loaded.result.value) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  for (const id of ids) {
    for (const end of ['rear', 'front']) {
      const shown = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.showLampVehicle(${JSON.stringify(id)}, ${JSON.stringify(end)})`, returnByValue: true });
      if (!shown.result.value) continue;
      await new Promise(resolve => setTimeout(resolve, 220));
      const capture = await command('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(new URL(`${id}-${end}.png`, outputDir), Buffer.from(capture.data, 'base64'));
    }
  }
  const audit = await command('Runtime.evaluate', { expression: 'window.__carDodgeTest?.lampAudit()', returnByValue: true });
  console.log(JSON.stringify({ browser: version.Browser, lamps: audit.result.value }, null, 2));
  socket.close();
  process.exit(0);
}

const expression = `(() => {
  const canvas = document.querySelector('canvas');
  document.querySelector('[data-mode="career"]')?.click();
  const start = document.querySelector('#start, #action[data-start-game]');
  const weather = document.querySelector('[data-weather="rain"]');
  weather?.click();
  start?.click();
  return {
    title: document.title,
    canvas: canvas ? [canvas.width, canvas.height] : null,
    startText: start?.textContent,
    startEnabled: start ? !start.disabled : false,
    weatherButton: document.querySelector('#weatherBtn')?.textContent,
    condition: document.querySelector('#condition')?.textContent,
    overlayHidden: document.querySelector('#overlay')?.classList.contains('hidden'),
    errorVisible: document.querySelector('#error')?.classList.contains('on')
  };
})()`;
const evaluation = await command('Runtime.evaluate', { expression, returnByValue: true });
const result = evaluation.result.value;
await new Promise(resolve => setTimeout(resolve, 250));
if (process.env.OPERA_EXIT_TRANSITION_TEST === '1') {
  const forced = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceOccupiedExit()`, returnByValue: true });
  const before = performance.now();
  const stepped = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(12); window.__carDodgeTest?.exitTransitionState()`, returnByValue: true });
  if (stepped.exceptionDetails) throw new Error(`Highway exit browser exception: ${JSON.stringify(stepped.exceptionDetails)}`);
  const elapsed = performance.now() - before, state = stepped.result.value;
  const landingEvaluation = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.exitLandingState()`, returnByValue: true });
  const landing = landingEvaluation.result.value;
  if (!forced.result.value || state.mode !== 'playing' || state.event || state.fade !== 0 || state.biome !== 'city' || state.damage > .01 || !landing?.clear || landing.nextWaveIn < 20 || elapsed > 12000 || runtimeExceptions.length) throw new Error(`Highway exit transition stalled, caused damage, or landed in traffic: ${JSON.stringify({ elapsed, state, landing, runtimeExceptions })}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, highwayExit: 'passed', damageDuringExit: state.damage, occupiedLandingCleared: landing.clear, nextWaveIn: landing.nextWaveIn, elapsed, state }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_ROUNDABOUT_YIELD_TEST === '1') {
  const evaluation = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRoundaboutYield(); window.__carDodgeTest?.step(4); window.__carDodgeTest?.roundaboutYieldState()`, returnByValue: true });
  if (evaluation.exceptionDetails) throw new Error(`Roundabout yield browser exception: ${JSON.stringify(evaluation.exceptionDetails)}`);
  const traffic = evaluation.result.value;
  if (traffic.length !== 2 || traffic.some(vehicle => vehicle.speed > .2 || !vehicle.braking || vehicle.distance < 29)) throw new Error(`Traffic stopped too close to a roundabout exit: ${JSON.stringify(traffic)}`);
  if (runtimeExceptions.length) throw new Error(`Roundabout yield uncaught errors: ${JSON.stringify(runtimeExceptions)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, roundaboutYield: 'passed', traffic }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_ARRIVAL_MENU_TEST === '1') {
  const evaluation = await command('Runtime.evaluate', { expression: `(() => { const active=Object.keys(window.__carDodgeTest||{}); window.__carDodgeTest?.forceArrival?.(); return active; })()`, returnByValue: true });
  if (evaluation.exceptionDetails) throw new Error(`Arrival browser exception: ${JSON.stringify(evaluation.exceptionDetails)}`);
  const menu = await command('Runtime.evaluate', { expression: `(() => ({mode:window.__carDodgeTest?.state()?.mode,destinations:document.querySelectorAll('#card .destination-choice').length,cars:document.querySelectorAll('#card .car-choice').length,weather:document.querySelectorAll('#card .weather-choice').length,time:document.querySelectorAll('#card .time-choice').length,button:document.querySelector('#card #action')?.textContent}))()`, returnByValue: true });
  const state = menu.result.value;
  if (state.mode !== 'arrived' || state.destinations !== 4 || state.cars < 6 || state.weather < 5 || state.time < 5 || !state.button?.includes('next')) throw new Error(`Arrival journey menu failed: ${JSON.stringify(state)}`);
  socket.close();
  console.log(JSON.stringify({browser:version.Browser,arrivalMenu:'passed',state},null,2));
  process.exit(0);
}
async function press(code, key, windowsVirtualKeyCode) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await new Promise(resolve => setTimeout(resolve, 150));
}
async function condition() {
  const value = await command('Runtime.evaluate', { expression: `document.querySelector('#condition')?.textContent`, returnByValue: true });
  return value.result.value;
}
if (process.env.OPERA_SYSTEMS_TEST === '1') {
  async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Browser evaluation failed');
    return response.result.value;
  }
  await evaluate(`window.__carDodgeTest.forceMajorEvent('roadworks', -70); window.__carDodgeTest.step(4)`);
  const roadworks = await evaluate(`window.__carDodgeTest.systemState()`);
  if (roadworks.event?.kind !== 'roadworks' || roadworks.safeRoutes !== 1 || roadworks.merging < 1) throw new Error(`Roadworks fairness/merge failed: ${JSON.stringify(roadworks)}`);

  await evaluate(`window.__carDodgeTest.forceMajorEvent('intersection', -55); window.__carDodgeTest.addSignalTraffic(); window.__carDodgeTest.setIntersectionPhase('red'); window.__carDodgeTest.step(2.4)`);
  const intersection = await evaluate(`window.__carDodgeTest.systemState()`);
  if (intersection.event?.phase !== 'red' || intersection.redStops < 1 || intersection.crossTraffic < 1) throw new Error(`Intersection signals failed: ${JSON.stringify(intersection)}`);
  const intersectionAudit = await evaluate(`window.__carDodgeTest.intersectionAudit()`);
  if (!intersectionAudit.hasCrossRoad || intersectionAudit.roadBounds[0] < 70 || intersectionAudit.roadBounds[2] < 13 || intersectionAudit.signals !== 4 || intersectionAudit.vehicles.some(vehicle => !vehicle.facesTravel)) throw new Error(`Crossroad geometry/direction failed: ${JSON.stringify(intersectionAudit)}`);
  await evaluate(`document.querySelector('#overlay')?.classList.add('hidden'); true`);
  const intersectionCapture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-crossroad.png', Buffer.from(intersectionCapture.data, 'base64'));

  const leftRoute = await evaluate(`window.__carDodgeTest.forceRouteChoice('left')`);
  const rightRoute = await evaluate(`window.__carDodgeTest.forceRouteChoice('right')`);
  if (!leftRoute || !rightRoute || leftRoute === rightRoute) throw new Error(`Route selection failed: ${JSON.stringify({ leftRoute, rightRoute })}`);

  const policeSpawned = await evaluate(`window.__carDodgeTest.forcePolice()`);
  const police = await evaluate(`window.__carDodgeTest.systemState()`);
  if (!policeSpawned || !police.police || police.wanted < 35) throw new Error(`Police response failed: ${JSON.stringify(police)}`);

  await evaluate(`window.__carDodgeTest.forceMajorEvent('incident', -65); window.__carDodgeTest.step(3)`);
  const incident = await evaluate(`window.__carDodgeTest.systemState()`);
  if (incident.event?.kind !== 'incident' || incident.safeRoutes !== 1 || incident.merging < 1) throw new Error(`Incident routing failed: ${JSON.stringify(incident)}`);

  const clearBrake = await evaluate(`window.__carDodgeTest.measureBrakingShort('clear')`);
  const rainBrake = await evaluate(`window.__carDodgeTest.measureBrakingShort('rain')`);
  const stormBrake = await evaluate(`window.__carDodgeTest.measureBrakingShort('storm')`);
  if (!(clearBrake.loss > rainBrake.loss && rainBrake.loss > stormBrake.loss)) throw new Error(`Weather braking physics failed: ${JSON.stringify({ clearBrake, rainBrake, stormBrake })}`);

  const personality = await evaluate(`window.__carDodgeTest.forceAggressiveDriver()`);
  const traits = (await evaluate(`window.__carDodgeTest.systemState()`)).traits;
  if (!personality.aggressive || !(traits.truck.accel < traits.hatchback.accel) || !(traits.truck.gap > traits.taxi.gap) || !traits.ambulance.emergency) throw new Error(`Traffic personalities failed: ${JSON.stringify({ personality, traits })}`);

  const challengeLabel = await evaluate(`window.__carDodgeTest.forceChallenge('near-miss')`);
  const challengeResult = await evaluate(`window.__carDodgeTest.completeChallengeTest()`);
  if (!challengeLabel.includes('NEAR MISSES') || challengeResult.active || challengeResult.bonus <= 0) throw new Error(`Challenge lifecycle failed: ${JSON.stringify({ challengeLabel, challengeResult })}`);

  const biome = await evaluate(`window.__carDodgeTest.forceBiome('industrial')`);
  const biomeState = await evaluate(`window.__carDodgeTest.systemState()`);
  if (biome !== 'industrial' || biomeState.biomeTarget !== 'industrial') throw new Error(`Biome transition failed: ${JSON.stringify(biomeState)}`);

  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-integrated-systems.png', Buffer.from(capture.data, 'base64'));
  if (runtimeExceptions.length) throw new Error(`Uncaught browser errors: ${JSON.stringify(runtimeExceptions)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, roadworks, intersection, intersectionAudit, routes: [leftRoute, rightRoute], police, incident, braking: { clear: clearBrake.loss, rain: rainBrake.loss, storm: stormBrake.loss }, personality, traits, challengeResult, biome: biomeState.biome }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_HORN_REACTION_TEST === '1') {
  const yieldResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceHornReaction(false)`, returnByValue: true });
  const blockedResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceHornReaction(true); window.__carDodgeTest?.step(.7)`, returnByValue: true });
  const yielded = yieldResult.result.value, blockedTraffic = blockedResult.result.value?.traffic || [], boosted = blockedTraffic.find(vehicle => vehicle.lane === 0);
  if (yielded?.targetLane !== 1) throw new Error(`Horned traffic did not signal a safe lane change: ${JSON.stringify(yielded)}`);
  if (!boosted || boosted.targetLane !== 0 || boosted.speed <= 9.5) throw new Error(`Blocked horned traffic did not accelerate safely: ${JSON.stringify(blockedTraffic)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, hornYieldTarget: yielded.targetLane, blockedSpeed: boosted.speed, blockedStayedInLane: true }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_RAILWAY_TEST === '1') {
  let railwayAssets;
  for (let attempt = 0; attempt < 80; attempt++) {
    const assetResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.trainAssetState?.()`, returnByValue: true });
    railwayAssets = assetResult.result.value;
    if (['ready', 'fallback'].includes(railwayAssets?.kenney)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (railwayAssets?.kenney !== 'ready') throw new Error(`Kenney train assets did not load: ${JSON.stringify(railwayAssets)}`);
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRailwayCrossing('xtrapolis'); window.__carDodgeTest?.step(3.5)`, returnByValue: true });
  const passengerResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.railwayState()`, returnByValue: true });
  const passenger = passengerResult.result.value;
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-railway-test.png', Buffer.from(screenshot.data, 'base64'));
  const variants = {};
  for (const kind of ['comeng', 'siemens', 'hcmt', 'bullet', 'subway', 'intercity', 'diesel']) {
    await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRailwayCrossing(${JSON.stringify(kind)}); window.__carDodgeTest?.step(3.5)`, returnByValue: true });
    const stateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.railwayState()`, returnByValue: true });
    variants[kind] = stateResult.result.value;
    const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(`assets/opera-railway-${kind}.png`, Buffer.from(capture.data, 'base64'));
  }
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRailwayCrossing('freight'); window.__carDodgeTest?.step(3.5)`, returnByValue: true });
  const freightResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.railwayState()`, returnByValue: true });
  const freight = freightResult.result.value;
  const replayResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.railwayReplayRoundTrip()`, returnByValue: true });
  const replay = replayResult.result.value;
  for (const state of [passenger, ...Object.values(variants), freight]) if (state?.state !== 'active' || state.gate < .99 || state.stopping !== 2 || state.forward >= 1.2 || state.oncoming >= 1.2) throw new Error(`AI traffic did not stop for railway crossing: ${JSON.stringify(state)}`);
  const expectedCars = { comeng: 6, siemens: 6, hcmt: 7, bullet: 6, subway: 6, intercity: 6, diesel: 7 };
  if (passenger.cars !== 6 || freight.cars !== 7 || Object.entries(expectedCars).some(([kind, count]) => variants[kind]?.cars !== count)) throw new Error(`Train consists are incomplete: ${JSON.stringify({ passenger, variants, freight })}`);
  for (const kind of ['bullet', 'subway', 'intercity', 'diesel']) if (!variants[kind].actualModel || variants[kind].assetState !== 'ready') throw new Error(`Actual ${kind} model was not used: ${JSON.stringify(variants[kind])}`);
  if (!replay || replay.error > .001) throw new Error(`Railway replay interpolation failed: ${JSON.stringify(replay)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, xtrapolis: passenger, ...variants, freight, replay }, null, 2));
  process.exit(0);
}
await press('KeyQ', 'q', 81);
result.leftCondition = await condition();
await press('KeyE', 'e', 69);
result.rightCondition = await condition();
await press('KeyZ', 'z', 90);
result.hazardCondition = await condition();
await command('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyH', key: 'h', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
await new Promise(resolve => setTimeout(resolve, 100));
await command('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyH', key: 'h', windowsVirtualKeyCode: 72, nativeVirtualKeyCode: 72 });
if (process.env.OPERA_CURVE_CAPTURE === '1') await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.curveRoad()`, returnByValue: true });
if (process.env.OPERA_SPEED_STEER_TEST === '1') {
  const steering = {};
  for (const speed of [0, 5, 20]) {
    await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.beginSteeringSpeedTest(${speed}); window.__carDodgeTest?.step(.35)`, returnByValue: true });
    const stateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.endSteeringSpeedTest()`, returnByValue: true });
    steering[speed] = stateResult.result.value;
  }
  if (Math.abs(steering[0].x) > .0001 || Math.abs(steering[0].yaw) > .0001 || !(steering[20].x > steering[5].x && steering[5].x > 0)) throw new Error(`Speed-based steering failed: ${JSON.stringify(steering)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, steering }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_LANE_TURN_TEST === '1') {
  const turns = {};
  for (const direction of ['right', 'left']) {
    await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceLaneTurn(${JSON.stringify(direction)}); window.__carDodgeTest?.step(.2)`, returnByValue: true });
    const turnResult = await command('Runtime.evaluate', { expression: `(() => { const vehicle=window.__carDodgeTest?.laneTurnState(); const base=Math.PI; const delta=Math.atan2(Math.sin(vehicle.yaw-base),Math.cos(vehicle.yaw-base)); return {...vehicle,delta}; })()`, returnByValue: true });
    turns[direction] = turnResult.result.value;
  }
  if (!(turns.right.delta < 0 && turns.left.delta > 0)) throw new Error(`Lane-change body yaw is reversed: ${JSON.stringify(turns)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, laneTurnYaw: { right: turns.right.delta, left: turns.left.delta } }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_CRASH_GARAGE_TEST === '1') {
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.showCrashGarage()`, returnByValue: true });
  const changedResult = await command('Runtime.evaluate', { expression: `(() => { document.querySelector('[data-car="suv"]')?.click(); document.querySelector('[data-weather="rain"]')?.click(); return window.__carDodgeTest?.state(); })()`, returnByValue: true });
  const changed = changedResult.result.value;
  if (changed.garageCars !== 6 || changed.selectedCar !== 'suv' || changed.weatherMode !== 'rain' || changed.overlayHidden) throw new Error(`Crash garage controls failed: ${JSON.stringify(changed)}`);
  await command('Runtime.evaluate', { expression: `document.querySelector('#action')?.click()`, returnByValue: true });
  const restartedResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const restarted = restartedResult.result.value;
  if (restarted.mode !== 'playing' || restarted.selectedCar !== 'suv' || restarted.weatherMode !== 'rain' || !restarted.overlayHidden) throw new Error(`Crash garage restart failed: ${JSON.stringify(restarted)}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, crashGarageCars: changed.garageCars, selectedCar: restarted.selectedCar, weather: restarted.weatherMode, restartedWithoutReload: true }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_REPLAY_PARTICLE_TEST === '1') {
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceAccidentTrafficTest()`, returnByValue: true });
  const impact = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRecoverableImpact()`, returnByValue: true });
  const freshResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const fresh = freshResult.result.value;
  if (!impact.result.value || fresh.effects < 1) throw new Error(`Recoverable impact emitted no particles: ${JSON.stringify(fresh)}`);
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(2.2)`, returnByValue: true });
  const clearedResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const cleared = clearedResult.result.value;
  if (cleared.effects !== 0) throw new Error(`Impact particles did not expire: ${JSON.stringify(cleared)}`);
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.clearReplay(); window.__carDodgeTest?.setSignal('left'); window.__carDodgeTest?.setHorn(true)`, returnByValue: true });
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(.8); window.__carDodgeTest?.setHorn(false); window.__carDodgeTest?.step(.3)`, returnByValue: true });
  const crashResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceCrash()`, returnByValue: true });
  if (!crashResult.result.value) throw new Error('Could not begin replay timing test');
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(.6)`, returnByValue: true });
  const replayAResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const replayHornAResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.hornActive()`, returnByValue: true });
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(.35)`, returnByValue: true });
  const replayBResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const replayHornBResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.hornActive()`, returnByValue: true });
  const replayA = replayAResult.result.value, replayB = replayBResult.result.value;
  const clockDelta = replayB.replayClock - replayA.replayClock, sourceDelta = replayB.replaySourceTime - replayA.replaySourceTime, replayRate = sourceDelta / Math.max(.001, clockDelta);
  if (replayA.mode !== 'replay' || replayB.mode !== 'replay' || replayRate < .9 || replayRate > 1.1 || replayA.playerSignal !== 'left' || replayB.playerSignal !== 'left' || !replayHornAResult.result.value || replayHornBResult.result.value) throw new Error(`Replay did not preserve speed, lights, and horn: ${JSON.stringify({ replayRate, replayHornA:replayHornAResult.result.value, replayHornB:replayHornBResult.result.value, replayA, replayB })}`);
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, particlesExpired: true, replayRate, replaySignal: replayB.playerSignal, replayHornRecorded:true, replayFrames: replayB.replayFrames }, null, 2));
  process.exit(0);
}
if (process.env.OPERA_SCENARIO_TEST === '1') {
  const scenarios = ['slow-truck', 'staggered-pair', 'fast-behind', 'bus-blindspot', 'sudden-braking', 'crowded-lane', 'accident-closure'];
  const audit = [];
  for (const scenario of scenarios) {
    const spawned = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceScenario(${JSON.stringify(scenario)})`, returnByValue: true });
    const stateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
    const state = stateResult.result.value;
    const vehicles = state.traffic.filter(vehicle => vehicle.scenario === scenario);
    const blockedTogether = vehicles.some(vehicle => vehicles.some(other => other !== vehicle && other.lane !== vehicle.lane && other.z < 0 && vehicle.z < 0 && Math.abs(other.z - vehicle.z) < 10));
    if (!spawned.result.value || !vehicles.length || blockedTogether) throw new Error(`Scenario is missing or blocks both forward lanes: ${scenario} ${JSON.stringify(state)}`);
    if (vehicles.some(vehicle => !vehicle.lockedLane || vehicle.laneError > .001 || vehicle.worldError > .001)) throw new Error(`Scenario traffic is not lane-stable: ${scenario} ${JSON.stringify(vehicles)}`);
    audit.push({ scenario, vehicles: vehicles.length, props: state.scenarioProps, hazards: vehicles.filter(vehicle => vehicle.hazard).length });
  }
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceAccidentTrafficTest()`, returnByValue: true });
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(4.6)`, returnByValue: true });
  const accidentStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const accidentState = accidentStateResult.result.value, follower = accidentState.traffic.find(vehicle => vehicle.scenario === 'accident-follower'), wreck = accidentState.traffic.find(vehicle => vehicle.scenario === 'accident-closure' && vehicle.lane === follower?.lane);
  const laneCentres = [-5.4, -1.8, 1.8, 5.4], activelyMerged = follower && (follower.targetLane !== follower.lane || follower.lane !== wreck?.lane || Math.abs(follower.lateral - laneCentres[follower.lane]) > .15);
  if (!follower || !wreck || follower.z < wreck.z || !activelyMerged) throw new Error(`AI did not merge around the accident: ${JSON.stringify(accidentState)}`);
  const scenarioScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-scenario-test.png', Buffer.from(scenarioScreenshot.data, 'base64'));
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, scenarioAudit: audit }, null, 2));
  process.exit(0);
}
if (!result.canvas || result.canvas[0] < 500 || result.canvas[1] < 300) throw new Error(`Invalid 3D canvas: ${JSON.stringify(result)}`);
if (!result.startEnabled) throw new Error(`Vehicle loading did not finish: ${JSON.stringify(result)}`);
if (!result.overlayHidden) throw new Error(`Game did not start: ${JSON.stringify(result)}`);
if (result.weatherButton !== '🌧️') throw new Error(`Weather selector failed: ${JSON.stringify(result)}`);
if (!result.leftCondition?.includes('LEFT')) throw new Error(`Q left indicator failed: ${JSON.stringify(result)}`);
if (!result.rightCondition?.includes('RIGHT')) throw new Error(`E right indicator failed: ${JSON.stringify(result)}`);
if (!result.hazardCondition?.includes('HAZARDS')) throw new Error(`Z hazards failed: ${JSON.stringify(result)}`);
if (result.errorVisible) throw new Error(`The WebGL error panel is visible: ${JSON.stringify(result)}`);
if (process.env.OPERA_RECOVERABLE_IMPACT === '1') {
  const impactResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceRecoverableImpact()`, returnByValue: true });
  await new Promise(resolve => setTimeout(resolve, 180));
  const impactStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  const impactState = impactStateResult.result.value;
  if (!impactResult.result.value || impactState.mode !== 'playing' || impactState.damage < 5 || impactState.damage >= 100) throw new Error(`Recoverable impact failed: ${JSON.stringify(impactState)}`);
  if (Math.abs(impactState.impactVX) < .05 && Math.abs(impactState.impactYaw) < .01) throw new Error(`Recoverable impact had no physical impulse: ${JSON.stringify(impactState)}`);
  const impactScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-impact-test.png', Buffer.from(impactScreenshot.data, 'base64'));
  await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.step(2.2)`, returnByValue: true });
  const clearedEffectsResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.state()`, returnByValue: true });
  if (clearedEffectsResult.result.value.effects !== 0) throw new Error(`Recoverable-impact particles did not expire: ${JSON.stringify(clearedEffectsResult.result.value)}`);
}
if (process.env.OPERA_TRAFFIC_WAIT_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.OPERA_TRAFFIC_WAIT_MS)));

const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('assets/opera-smoke-test.png', Buffer.from(screenshot.data, 'base64'));
await press('KeyC', 'c', 67);
const cabScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('assets/opera-cab-test.png', Buffer.from(cabScreenshot.data, 'base64'));
if (process.env.OPERA_CAPTURE_ONLY === '1') {
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, captureOnly: true, canvas: result.canvas }, null, 2));
  process.exit(0);
}
const preCrashStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
const preCrashState = preCrashStateResult.result.value;
const badFreshTraffic = preCrashState.traffic.filter(vehicle => vehicle.spawnAge <= 5 && (vehicle.laneError > 0.001 || vehicle.worldError > 0.001));
if (badFreshTraffic.length) throw new Error(`Fresh traffic spawned outside its lane: ${JSON.stringify(badFreshTraffic)}`);
if (preCrashState.garageCars<6) throw new Error(`Garage vehicles missing: ${JSON.stringify(preCrashState)}`);
if (preCrashState.rpm<800 || preCrashState.gear<1) throw new Error(`Transmission did not initialize: ${JSON.stringify(preCrashState)}`);
if (preCrashState.replayFrames<1) throw new Error(`Replay buffer did not record: ${JSON.stringify(preCrashState)}`);
if (process.env.OPERA_LANE_ONLY === '1') {
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, laneCheck: 'passed', traffic: preCrashState.traffic }, null, 2));
  process.exit(0);
}
const forced = await command('Runtime.evaluate', { expression: `window.__carDodgeTest?.forceCrash()`, returnByValue: true });
if (!forced.result.value) throw new Error('Could not trigger the isolated pile-up test');
await new Promise(resolve => setTimeout(resolve, 650));
const replayStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
const replayState = replayStateResult.result.value;
if (replayState.mode !== 'replay' || !replayState.replayBanner) throw new Error(`Crash replay did not start visibly: ${JSON.stringify(replayState)}`);
if (process.env.OPERA_CRASH_PERF !== '1') {
  const replayScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('assets/opera-replay-test.png', Buffer.from(replayScreenshot.data, 'base64'));
}
await new Promise(resolve => setTimeout(resolve, 350));
const movingReplayResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
const movingReplay = movingReplayResult.result.value;
if (Math.abs(movingReplay.worldZ-replayState.worldZ)<.05) throw new Error(`Replay world did not scroll: ${JSON.stringify({replayState,movingReplay})}`);
const replayClockDelta=movingReplay.replayClock-replayState.replayClock,replaySourceDelta=movingReplay.replaySourceTime-replayState.replaySourceTime,replayRate=replaySourceDelta/Math.max(.001,replayClockDelta);
if (replayRate<.9||replayRate>1.1) throw new Error(`Replay source time is not real-time: ${JSON.stringify({replayRate,replayState,movingReplay})}`);
if (process.env.OPERA_CRASH_PERF === '1') {
  await new Promise(resolve => setTimeout(resolve, 3500));
  const perfResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
  socket.close();
  console.log(JSON.stringify({ browser: version.Browser, crashPerformance: perfResult.result.value }, null, 2));
  process.exit(0);
}
await new Promise(resolve => setTimeout(resolve, 9000));
const pileupStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
const pileupState = pileupStateResult.result.value;
await new Promise(resolve => setTimeout(resolve, 300));
const laterStateResult = await command('Runtime.evaluate', { expression: `window.__carDodgeTest.state()`, returnByValue: true });
const laterState = laterStateResult.result.value;
const trafficStillMoving = pileupState.traffic.some((vehicle, index) => !vehicle.crashed && laterState.traffic[index] && Math.abs(vehicle.z-laterState.traffic[index].z)>.1);
if (pileupState.pileups<1) throw new Error(`Pile-up did not form: ${JSON.stringify(pileupState)}`);
if (!trafficStillMoving) throw new Error(`Unaffected traffic stopped after crash: ${JSON.stringify({pileupState,laterState})}`);
if (pileupState.damage<=0) throw new Error(`Damage was not applied: ${JSON.stringify(pileupState)}`);
if (pileupState.records.crashes<1 || pileupState.credits<1) throw new Error(`Progression/statistics were not saved: ${JSON.stringify(pileupState)}`);
result.pileups = pileupState.pileups;
result.trafficStillMoving = trafficStillMoving;
result.replay = true;
result.damage = Math.round(pileupState.damage);
result.gear = preCrashState.gear;
result.rpm = Math.round(preCrashState.rpm);
result.garageCars = preCrashState.garageCars;
result.creditsEarned = pileupState.credits;
const pileupScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await writeFile('assets/opera-pileup-test.png', Buffer.from(pileupScreenshot.data, 'base64'));
console.log(JSON.stringify({ browser: version.Browser, ...result }, null, 2));
socket.close();
