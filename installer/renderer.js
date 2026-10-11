const $ = (id) => document.getElementById(id)
let target = ''

function mb(bytes) { return (bytes / 1e6).toFixed(1) }
function time(seconds) {
  if (!isFinite(seconds)) return ''
  const s = Math.round(seconds)
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s left` : `${s} s left`
}
function show(ids) {
  for (const id of ['start', 'cancel', 'retry', 'quit', 'open']) $(id).hidden = !ids.includes(id)
}

window.installer.onState((state) => {
  $('status').textContent = state.text
  $('status').className = 'status' + (state.phase === 'error' ? ' error' : '')
  const busy = ['connecting', 'installing', 'verifying', 'engine'].includes(state.phase)
  $('bar').className = 'bar' + (busy ? ' busy' : '')
  if (state.phase === 'downloading') {
    $('fill').style.width = `${Math.min(100, (state.done / state.total) * 100)}%`
    const percent = Math.floor((state.done / state.total) * 100)
    $('detail').textContent = `${percent}% · ${mb(state.done)} of ${mb(state.total)} MB · ${mb(state.speed)} MB/s · ${time(state.eta)}`
  } else if (state.phase === 'done') {
    $('fill').style.width = '100%'
    $('detail').textContent = state.target
    target = state.target
  } else {
    $('detail').textContent = state.detail || ''
  }
  if (state.phase === 'error' || state.phase === 'cancelled') { $('fill').style.width = '0'; show(['retry', 'quit']) }
  else if (state.phase === 'done') show(['open', 'quit'])
  else show(['cancel'])
})

$('start').onclick = () => { show(['cancel']); window.installer.start() }
$('retry').onclick = () => { show(['cancel']); window.installer.start() }
$('cancel').onclick = () => window.installer.cancel()
$('quit').onclick = () => window.installer.quit()
$('open').onclick = () => window.installer.openApp(target)
