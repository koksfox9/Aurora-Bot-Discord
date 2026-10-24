const state = {
  token: localStorage.getItem("auroraToken") || "",
  guildId: localStorage.getItem("auroraGuild") || "",
  snapshots: [],
  voiceChannels: []
};

const $ = (id) => document.getElementById(id);

const tokenInput = $("tokenInput");
const guildSelect = $("guildSelect");
const guildInput = $("guildInput");
const voiceChannelSelect = $("voiceChannelSelect");
const connectionState = $("connectionState");
const voiceState = $("voiceState");
const modeState = $("modeState");
const nowTitle = $("nowTitle");
const nowArtist = $("nowArtist");
const cover = $("cover");
const nextTrack = $("nextTrack");
const queueList = $("queueList");
const volume = $("volume");
const filter = $("filter");
const stay = $("stay");

tokenInput.value = state.token;
guildInput.value = state.guildId;

const socket = io({
  auth: {
    token: state.token
  }
});

socket.on("connect", () => {
  connectionState.textContent = "Polaczono";
  void refresh();
});

socket.on("disconnect", () => {
  connectionState.textContent = "Rozlaczono";
});

socket.on("connect_error", (error) => {
  connectionState.textContent = error.message === "Unauthorized" ? "Wpisz token panelu" : "Nie mozna polaczyc";
});

socket.on("snapshots", (snapshots) => {
  state.snapshots = snapshots;
  render();
  void loadVoiceChannels();
});

socket.on("playback", (event) => {
  const index = state.snapshots.findIndex((snapshot) => snapshot.guildId === event.guildId);
  if (index >= 0) state.snapshots[index] = event.snapshot;
  else state.snapshots.push(event.snapshot);
  render();
});

$("saveToken").addEventListener("click", () => {
  state.token = tokenInput.value.trim();
  localStorage.setItem("auroraToken", state.token);
  location.reload();
});

$("useGuild").addEventListener("click", () => {
  state.guildId = guildInput.value.trim();
  localStorage.setItem("auroraGuild", state.guildId);
  render();
  void loadVoiceChannels();
});

guildSelect.addEventListener("change", () => {
  state.guildId = guildSelect.value;
  guildInput.value = state.guildId;
  localStorage.setItem("auroraGuild", state.guildId);
  render();
  void loadVoiceChannels();
});

$("connectVoice").addEventListener("click", async () => {
  if (!voiceChannelSelect.value) {
    alert("Wybierz kanal glosowy.");
    return;
  }
  await api(`/api/guilds/${currentGuildId()}/connect`, { channelId: voiceChannelSelect.value });
});

$("playForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("queryInput").value.trim();
  if (!query) return;
  await api(`/api/guilds/${currentGuildId()}/play`, { query });
  $("queryInput").value = "";
});

$("radioForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = $("radioUrl").value.trim();
  const name = $("radioName").value.trim();
  if (!url) return;
  await api(`/api/guilds/${currentGuildId()}/radio`, { url, name });
});

$("skip").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/skip`));
$("shuffle").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/shuffle`));
$("stop").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/stop`));
$("pause").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/pause`));
$("resume").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/resume`));
$("clear").addEventListener("click", () => api(`/api/guilds/${currentGuildId()}/clear`));

for (const input of [volume, stay]) {
  input.addEventListener("change", saveSettings);
}
filter.addEventListener("change", () => api(`/api/guilds/${currentGuildId()}/filter`, { mode: filter.value }));

async function saveSettings() {
  await api(`/api/guilds/${currentGuildId()}/settings`, {
    volume: Number(volume.value) / 100,
    stayInChannel: stay.checked
  });
}

async function refresh() {
  const response = await fetch("/api/guilds", {
    headers: headers()
  });
  if (response.ok) {
    state.snapshots = await response.json();
    render();
    await loadVoiceChannels();
  } else if (response.status === 401) {
    connectionState.textContent = "Wpisz token panelu";
  }
}

async function loadVoiceChannels() {
  if (!state.guildId) {
    state.voiceChannels = [];
    renderVoiceChannels();
    return;
  }

  const response = await fetch(`/api/guilds/${state.guildId}/voice-channels`, {
    headers: headers()
  });
  if (!response.ok) {
    state.voiceChannels = [];
    renderVoiceChannels();
    return;
  }
  state.voiceChannels = await response.json();
  renderVoiceChannels();
}

async function api(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers()
    },
    body: JSON.stringify(body || {})
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    alert(error.error || "Request failed");
    return;
  }

  const snapshot = await response.json();
  const index = state.snapshots.findIndex((item) => item.guildId === snapshot.guildId);
  if (index >= 0) state.snapshots[index] = snapshot;
  else state.snapshots.push(snapshot);
  render();
}

function headers() {
  return state.token ? { "x-panel-token": state.token } : {};
}

function currentGuildId() {
  if (!state.guildId) throw new Error("Guild ID is missing");
  return state.guildId;
}

function renderVoiceChannels() {
  const selected = voiceChannelSelect.value;
  voiceChannelSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Wybierz kanal";
  voiceChannelSelect.append(placeholder);
  for (const channel of state.voiceChannels) {
    const option = document.createElement("option");
    option.value = channel.id;
    option.textContent = channel.name;
    voiceChannelSelect.append(option);
  }
  voiceChannelSelect.value = selected;
}

function render() {
  guildSelect.innerHTML = "";
  for (const snapshot of state.snapshots) {
    const option = document.createElement("option");
    option.value = snapshot.guildId;
    option.textContent = snapshot.guildId;
    guildSelect.append(option);
  }

  if (!state.guildId && state.snapshots[0]) {
    state.guildId = state.snapshots[0].guildId;
    guildInput.value = state.guildId;
  }
  guildSelect.value = state.guildId;

  const snapshot = state.snapshots.find((item) => item.guildId === state.guildId);
  if (!snapshot) {
    voiceState.textContent = "Bez polaczenia";
    modeState.textContent = "24h wylaczone";
    nowTitle.textContent = "Nic nie gra";
    nowArtist.textContent = "";
    cover.removeAttribute("src");
    nextTrack.textContent = "Nastepny: brak";
    queueList.innerHTML = "";
    return;
  }

  voiceState.textContent = snapshot.connected ? "Polaczono z kanalem" : "Bez polaczenia";
  modeState.textContent = snapshot.settings.stayInChannel ? "24h wlaczone" : "24h wylaczone";
  nowTitle.textContent = snapshot.current?.title || "Nic nie gra";
  nowArtist.textContent = snapshot.current?.artist || snapshot.current?.source || "";
  if (snapshot.current?.thumbnail) cover.src = snapshot.current.thumbnail;
  else cover.removeAttribute("src");
  nextTrack.textContent = `Nastepny: ${snapshot.next?.title || "brak"}`;

  volume.value = Math.round(snapshot.settings.volume * 100);
  stay.checked = snapshot.settings.stayInChannel;

  queueList.innerHTML = "";
  for (const track of snapshot.queue) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    title.textContent = track.title;
    meta.textContent = [track.artist, track.source, track.isLive ? "live" : ""].filter(Boolean).join(" | ");
    item.append(title, meta);
    queueList.append(item);
  }
}

refresh();
