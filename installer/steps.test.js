const test = require('node:test')
const assert = require('node:assert/strict')
const {
  missingVcRuntime,
  parseNvidiaSmi,
  describeGpu,
  percentOf,
  windowsMajor,
  VC_RUNTIME_FILES,
  VC_OK_CODES
} = require('./steps')

test('nothing is missing when every runtime file exists', () => {
  assert.deepEqual(missingVcRuntime('C:\\Windows\\System32', () => true), [])
})

test('every file is missing on a computer without the redistributable', () => {
  assert.deepEqual(missingVcRuntime('C:\\Windows\\System32', () => false), VC_RUNTIME_FILES)
})

test('an old 2015 redistributable (no vcruntime140_1) counts as missing', () => {
  const have = (file) => !file.endsWith('vcruntime140_1.dll')
  assert.deepEqual(missingVcRuntime('C:\\Windows\\System32', have), ['vcruntime140_1.dll'])
})

test('the files are looked up with Windows separators, also for a Cyrillic folder', () => {
  const seen = []
  missingVcRuntime('D:\\Windows нова\\System32', (file) => (seen.push(file), true))
  assert.equal(seen[0], 'D:\\Windows нова\\System32\\vcruntime140.dll')
})

test('the installer accepts "already installed" and "restart advised" as success', () => {
  for (const code of [0, 1638, 3010, 1641]) assert.ok(VC_OK_CODES.includes(code))
  assert.ok(!VC_OK_CODES.includes(1602)) // 1602 = the user cancelled
})

test('parses one and two graphics cards', () => {
  const text = 'NVIDIA GeForce RTX 3060, 551.23, 12288\r\nNVIDIA GeForce GTX 1050, 551.23, 2048\r\n'
  const cards = parseNvidiaSmi(text)
  assert.equal(cards.length, 2)
  assert.deepEqual(cards[0], { name: 'NVIDIA GeForce RTX 3060', driver: '551.23', memoryGb: 12 })
  assert.equal(cards[1].memoryGb, 2)
})

test('ignores empty or broken nvidia-smi output', () => {
  assert.deepEqual(parseNvidiaSmi(''), [])
  assert.deepEqual(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate'), [])
})

test('a name with a comma stays whole', () => {
  const [card] = parseNvidiaSmi('NVIDIA RTX A2000, Laptop, 537.13, 4096')
  assert.equal(card.name, 'NVIDIA RTX A2000, Laptop')
  assert.equal(card.driver, '537.13')
})

test('no card: the warning says it will be slow', () => {
  const result = describeGpu([])
  assert.equal(result.ok, false)
  assert.match(result.text, /much slower/)
})

test('a new driver is fine and an old one is reported', () => {
  assert.equal(describeGpu([{ name: 'RTX 4070', driver: '555.85', memoryGb: 12 }]).ok, true)
  const old = describeGpu([{ name: 'GTX 970', driver: '472.12', memoryGb: 4 }])
  assert.equal(old.ok, false)
  assert.match(old.text, /528\.33/)
})

test('reads the percent from the download output', () => {
  assert.equal(percentOf('  42%'), 42)
  assert.equal(percentOf('Downloading TripoSG (MIT license, about 7.9 GB)'), null)
  assert.equal(percentOf('  100%'), 100)
  assert.equal(percentOf('  250%'), 100)
})

test('progress bars of other downloads (the background model) are not taken as the model percent', () => {
  assert.equal(percentOf('u2net.onnx:  37%|███▋      | 65.0M/176M [00:03<00:05, 20MB/s]'), null)
  assert.equal(percentOf('Preparing the background removal model (about 176 MB)...'), null)
})

test('Windows 10 and 11 report major version 10', () => {
  assert.equal(windowsMajor('10.0.19045'), 10)
  assert.equal(windowsMajor('10.0.22631'), 10)
  assert.equal(windowsMajor('6.1.7601'), 6)
  assert.equal(windowsMajor(''), 0)
})
