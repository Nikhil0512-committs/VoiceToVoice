require("dotenv").config();
const cors = require("cors");
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const PORT = process.env.PORT || 3000

const textToSpeech = require("@google-cloud/text-to-speech");
const speech = require("@google-cloud/speech").v1;


const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const upload = multer({ dest: "/tmp/uploads/" });
if (!fs.existsSync("/tmp/uploads")) {
  fs.mkdirSync("/tmp/uploads", { recursive: true });
}

app.use(express.json());
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
}));
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Backend is live 🚀",
  }); 
});

const googleCredentials = JSON.parse(
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON
);


const ttsClient = new textToSpeech.TextToSpeechClient({
  credentials: googleCredentials,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const sttClient = new speech.SpeechClient({
  credentials: googleCredentials,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);



// ---------- LANGUAGE DETECTION ----------
function detectLanguage(text) {
  const hindiHints = [
    "है", "था", "किया", "नही", "क्यों", "मैं", "मेरा",
    "मुझे", "मैंने", "अपने", "चाहिए", "दोस्त", "आगे"
  ];
  const lower = text.toLowerCase();
  const score = hindiHints.filter(w => lower.includes(w)).length;
  return score >= 2 ? "hi" : "en";
}



// ---------- SPEECH TO TEXT ----------
async function speechToText(audioPath) {
  return new Promise((resolve) => {
    const audioStream = fs.createReadStream(audioPath);

    const request = {
      config: {
        encoding: "WEBM_OPUS",
        sampleRateHertz: 48000,
        languageCode: "en-IN",
        alternativeLanguageCodes: ["hi-IN"],
        enableAutomaticPunctuation: true,
      },
      interimResults: false,
    };

    let transcript = "";

    const recognizeStream = sttClient
      .streamingRecognize(request)
      .on("error", err => {
        console.error("Streaming STT error:", err);
        resolve({ text: "", lang: "en" });
      })
      .on("data", data => {
        if (data.results[0]?.alternatives[0]) {
          transcript += data.results[0].alternatives[0].transcript;
        }
      })
      .on("end", () => {
        if (!transcript) {
          resolve({ text: "", lang: "en" });
        } else {
          resolve({
            text: transcript,
            lang: detectLanguage(transcript),
          });
        }
      });

    audioStream.pipe(recognizeStream);
  });
}


async function chatWithAI(userText, lang, memory) {
  if (!userText) {
    return lang === "hi"
      ? "क्षमा करें, मुझे कुछ सुनाई नहीं दिया।"
      : "Sorry, I did not catch that.";
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
  });

  // Build previous conversation context
  let contextText = "";
  if (memory?.history?.length) {
    contextText = memory.history
      .map(m =>
        m.role === "user"
          ? `User: ${m.text}`
          : `NyaySaathi: ${m.text}`
      )
      .join("\n");
  }

  const systemPrompt =
    (lang === "hi"
      ? "आप NyaySaathi हैं, एक भारतीय कानूनी सहायता AI। आप एक योग्य भारतीय वकील की तरह बात करते हैं। आपकी भाषा शांत, सम्मानजनक, संवेदनशील और पेशेवर होती है और आप कानूनी बातों को आम लोगों के लिए सरल व स्पष्ट शब्दों में समझाते हैं। आप हमेशा पर्याप्त विस्तार से उत्तर देते हैं, बहुत छोटे या एक पंक्ति के उत्तर नहीं देते और प्रत्येक उत्तर कई छोटे अनुच्छेदों में देते हैं ताकि उपयोगकर्ता स्थिति को अच्छी तरह समझ सके। आप भारतीय कानून के अंतर्गत कानूनी अधिकारों, उपलब्ध उपायों और सही कानूनी प्रक्रिया को समझाने में मदद करते हैं, किसी परिणाम की गारंटी नहीं देते, कोई अवैध सलाह नहीं देते और टकराव या हिंसा को प्रोत्साहित नहीं करते। आप पहले कानूनी स्थिति स्पष्ट करते हैं, फिर व्यावहारिक कदम बताते हैं, फिर आवश्यक सबूत या दस्तावेज़ समझाते हैं, फिर भारत के समान मामलों के सामान्य उदाहरण देते हैं और अंत में बताते हैं कि कब वकील, पुलिस, स्कूल प्रबंधन, नियोक्ता या सरकारी प्राधिकरण से संपर्क करना चाहिए। आप केवल सादा पाठ का उपयोग करते हैं, बुलेट पॉइंट, नंबरिंग, चिन्ह, मार्कडाउन या इमोजी का उपयोग नहीं करते और वॉयस आउटपुट के लिए उपयुक्त छोटे अनुच्छेदों में लिखते हैं। यदि मामला नाबालिगों, महिलाओं, उत्पीड़न, बुलीइंग, शोषण या सुरक्षा से जुड़ा हो तो आप अतिरिक्त संवेदनशीलता और सहानुभूति दिखाते हैं और यदि जानकारी अपर्याप्त हो तो विनम्रता से केवल प्रासंगिक अनुवर्ती प्रश्न पूछते हैं।"

      : "You are NyaySaathi, an Indian legal assistance AI.\n\nYou speak like a qualified Indian lawyer. Your tone is calm, respectful, empathetic, and professional. You explain legal concepts clearly to non-lawyers.\n\nYou must give sufficiently detailed explanations. Do not give one-line or very short answers. Each response should normally be several short paragraphs so the user clearly understands the situation.\n\nYou help users understand their legal rights, available remedies, and correct legal procedure under Indian law. You do not promise outcomes. You do not give illegal advice. You do not encourage confrontation or violence.\n\nYou always explain the legal position first in clear terms. Then explain what the user can do in practical steps. Then explain what kind of evidence or documents are usually important. Then give one or two brief real-world examples of similar situations that have occurred in India, described in general terms. Then explain when it is necessary to approach a lawyer, police, school authority, employer, or government body.\n\nUse plain text only. Do not use asterisks, bullet points, numbering, markdown, emojis, or special formatting. Use short paragraphs suitable for voice output, but do not over-summarize.\n\nIf the matter involves minors, women, harassment, bullying, abuse, or safety, respond with extra care and sensitivity.\n\nIf information is insufficient, politely ask relevant follow-up questions.")
    +
    (memory?.topic
      ? `\n\nThe ongoing legal matter topic is: ${memory.topic}. Continue on the same matter unless the user clearly introduces a new issue.`
      : "");

  const result = await model.generateContent({
    systemInstruction: systemPrompt,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              (contextText ? `Previous conversation:\n${contextText}\n\n` : "") +
              (lang === "hi"
                ? `उपयोगकर्ता आगे कह रहा है:\n${userText}`
                : `Respond only in English. The user is continuing the same legal matter:\n${userText}`)
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 1400,
    },
  });

  return result.response.text();
}



// ---------- TEXT TO SPEECH ----------
async function convertTextToMp3(text, lang) {
  if (!text || !text.trim()) {
    throw new Error("Empty text passed to TTS");
  }

  const MAX_CHUNK_SIZE = 4000;
  const chunks = text.match(new RegExp(`.{1,${MAX_CHUNK_SIZE}}`, "g")) || [text];
  const audioBuffers = [];

  for (const chunk of chunks) {
    const request = {
      input: { text: chunk },
      voice: {
        languageCode: lang === "hi" ? "hi-IN" : "en-IN",
        ssmlGender: "NEUTRAL",
      },
      audioConfig: { audioEncoding: "MP3" },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    audioBuffers.push(response.audioContent);
  }

  return Buffer.concat(audioBuffers);
}



app.post("/api/voice", upload.single("audio"), async (req, res) => {
  let audioPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file received" });
    }

    audioPath = req.file.path;

    const memory = req.body.memory
      ? JSON.parse(req.body.memory)
      : null;

    const sttResult = await speechToText(audioPath);

    const aiReply = await Promise.race([
    chatWithAI(sttResult.text, sttResult.lang, memory),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI timeout")), 25000)
    )
    ]);


    const audioBuffer = await convertTextToMp3(
      aiReply,
      sttResult.lang
    );

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    
    res.json({
      text: aiReply,
      lang: sttResult.lang,
      audio: audioBuffer.toString("base64")
    });
    console.log(sttResult)
  } catch (err) {
    console.error("Pipeline Error:", err);
    if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    res.status(500).json({ error: "Voice processing failed." });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on PORT ${PORT}`);
});
