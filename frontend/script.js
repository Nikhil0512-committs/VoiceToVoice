let mediaRecorder;
let audioChunks = [];

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusText = document.getElementById("status");
const audioPlayer = document.getElementById("audioPlayer");

const MEMORY_KEY = "nyaySaathiMemory";

/* ---------------- MEMORY HELPERS ---------------- */

function getMemory() {
  const stored = sessionStorage.getItem(MEMORY_KEY);
  return stored
    ? JSON.parse(stored)
    : {
        topic: null,
        lang: null,
        history: []
      };
}

function saveMemory(memory) {
  sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
}

function resetMemory() {
  sessionStorage.removeItem(MEMORY_KEY);
}

/* ------------------------------------------------ */

startBtn.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";

    mediaRecorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );

    audioChunks = [];

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
      sendAudioToServer();
    };

    mediaRecorder.start();

    statusText.innerText = "Recording...";
    startBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (err) {
    console.error(err);
    statusText.innerText = "Microphone access denied";
  }
};

stopBtn.onclick = () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    statusText.innerText = "Processing...";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
};

async function sendAudioToServer() {
  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  const memory = getMemory();

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("memory", JSON.stringify(memory));

  try {
    const response = await fetch("https://voicetovoice-oyay.onrender.com/", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    // ✅ RECEIVE JSON (TEXT + AUDIO)
    const data = await response.json();

    // ✅ PLAY AUDIO
    const audioBlob = new Blob(
      [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))],
      { type: "audio/mpeg" }
    );

    const audioUrl = URL.createObjectURL(audioBlob);
    audioPlayer.src = audioUrl;
    audioPlayer.play();

    // ✅ STORE REAL MEMORY
    updateConversationHistory(
      memory,
      data.text,
      data.lang
    );

    statusText.innerText = "Response received";
  } catch (err) {
    console.error(err);
    statusText.innerText = "Error processing voice";
  }
}

/* --------- REAL MEMORY STORAGE ---------- */

function updateConversationHistory(memory, aiText, lang) {
  memory.lang = memory.lang || lang;

  memory.history.push(
    { role: "user", text: "User spoke via voice" },
    { role: "assistant", text: aiText }
  );

  if (memory.history.length > 8) {
    memory.history = memory.history.slice(-8);
  }

  saveMemory(memory);
}
