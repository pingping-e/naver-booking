const form = document.querySelector('form'), status = document.querySelector('#status');
const {config} = await chrome.storage.local.get('config');
if (config) for (const [name, value] of Object.entries(config)) {
  const field = form.elements.namedItem(name);
  if (!field) continue;
  if (field.type === 'checkbox') field.checked = value;
  else field.value = Array.isArray(value) ? value.join(', ') : value;
}
if (config?.dates) config.dates.forEach((date, index) => {
  form.elements.namedItem(index === 0 ? 'date' : `date${index + 1}`).value = date;
});
async function render() {
  const {job, logs = []} = await chrome.storage.local.get(['job', 'logs']);
  status.textContent = job?.status || '대기 중';
  document.querySelector('#logs').replaceChildren(...logs.map(entry => {
    const li = document.createElement('li'); li.textContent = `${new Date(entry.at).toLocaleTimeString()} ${entry.message}`; return li;
  }));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.dates = ['date', 'date2', 'date3', 'date4', 'date5'].map(name => data[name]).filter(Boolean);
  data.times = data.times.split(',').map(t => t.trim()).filter(Boolean);
  data.autoConfirm = form.elements.autoConfirm.checked;
  try {
    const response = await chrome.runtime.sendMessage({type: 'START', config: data});
    if (!response.ok) throw new Error(response.error);
    await chrome.storage.local.set({config: data});
    await render();
  } catch (error) {status.textContent = error.message;}
});
document.querySelector('#stop').addEventListener('click', async () => {await chrome.runtime.sendMessage({type: 'STOP'}); await render();});
chrome.storage.onChanged.addListener(render);
await render();
