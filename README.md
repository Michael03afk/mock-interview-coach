# AI Mock Interview Coach 🎙️

An interactive full-stack AI Mock Interview Coach web application. It parses your PDF resume, dynamically generates targeted interview questions matching your domain, experience, and difficulty level using the Antigravity (Gemini) API, administers a real-time 90-second interview with an animated Three.js canvas background, and delivers comprehensive AI scoring, strengths, improvements, and exemplary sample answers for every response.

---

## 🌟 Key Features

- **Dynamic 3D Particle & Torus Visualizer**: Built with Three.js with responsive motion and reactive screen palette shifting.
- **Resume Text Extraction**: In-memory parsing of PDF resumes using `pdf-parse` (max 5 MB) without storing files to disk.
- **Customizable Interview Focus**:
  - **Domains**: *Web development*, *Data and AI*, *Embedded and IoT*, *VLSI and electronics*, *HR and behavioral*.
  - **Levels**: *Beginner*, *Intermediate*, *Advanced*.
  - **Question Counts**: 3, 5, 8, or 10 questions.
- **Smart Interview Flow**:
  - Live 90-second circular countdown timer per question.
  - Quick skip or manual save and advance.
  - Auto-advance on timeout.
- **Comprehensive AI Evaluation**:
  - Question-by-question scoring (1–10).
  - Highlighted strengths and concrete actionable improvements.
  - Tailored high-impact sample answers.
  - Overall average session score.
- **Production-Ready Node/Express Backend**:
  - Centralized `callAI()` service with 30-second timeout, 1 retry on transient failure, and safe response parsing.
  - Built-in IP rate limiting (20 requests per minute).
  - Absolute privacy: API keys and raw resume texts are never logged or leaked to the client.
  - Render deployment blueprint (`render.yaml`).

---

## 📁 Project Structure

```
├── .env.example        # Environment variable template
├── .gitignore          # Git ignore rules (node_modules, .env, logs)
├── package.json        # Dependencies and scripts (node server.js)
├── public/
│   └── index.html      # Frontend with Three.js 3D backdrop & client logic
├── README.md           # Documentation, run, and deployment guide
├── render.yaml         # Render Infrastructure-as-Code deployment blueprint
└── server.js           # Express server, PDF extraction, API routes, and callAI
```

---

## 🚀 Quickstart: Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18.0.0 or higher)
- npm (bundled with Node.js)
- An AI API Key (Google AI Studio / Antigravity Gemini API Key)

### Step 1: Install Dependencies

From the project root directory, run:

```bash
npm install
```

### Step 2: Configure Environment Variables

Copy `.env.example` to create your local `.env` file:

**On Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

**On Linux/macOS:**
```bash
cp .env.example .env
```

Open `.env` in your text editor and set your actual API key:

```env
AI_API_KEY=AIzaSy...YourActualGeminiApiKeyHere
PORT=3000
```

### Step 3: Start the Server

```bash
npm start
```

You should see:
```
AI Mock Interview Coach server running on port 3000
Local URL: http://localhost:3000
```

### Step 4: Open in Your Browser

Navigate to:
```
http://localhost:3000
```

Upload a PDF resume, select your domain and difficulty, and start practicing!

---

## 🌐 Deploying to GitHub

1. Initialize a git repository (if not already done):
   ```bash
   git init
   ```

2. Add all files and make the initial commit:
   ```bash
   git add .
   git commit -m "Initial commit: AI Mock Interview Coach"
   ```

3. Create a new repository on [GitHub](https://github.com/new).

4. Link the remote and push your code:
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git branch -M main
   git push -u origin main
   ```

---

## ☁️ Deploying to Render

This project contains a `render.yaml` blueprint for 1-click deployment as a Web Service.

### Option A: Using the Render Blueprint (`render.yaml`)

1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Blueprint**.
3. Connect your GitHub repository.
4. Render will parse `render.yaml` and configure the Web Service automatically:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. In the **Environment Variables** section, locate `AI_API_KEY` (marked unsynced) and paste your secret API key.
6. Click **Apply**. Render will build and deploy the web service with an HTTPS URL.

### Option B: Manual Web Service Setup on Render

1. Go to [Render Dashboard](https://dashboard.render.com/) > **New +** > **Web Service**.
2. Connect your GitHub repository.
3. Configure settings:
   - **Name**: `ai-mock-interview-coach`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
4. Under **Environment Variables**, add:
   - `AI_API_KEY` = `<your-api-key>`
   - `PORT` = `3000`
5. Click **Create Web Service**.

---

## 🔒 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check endpoint, returns `{ ok: true }`. |
| `POST` | `/api/questions` | Accepts `multipart/form-data` (`resume`, `domain`, `level`, `count`). Extracts PDF text, prompts AI, returns `{ questions: [...] }`. |
| `POST` | `/api/feedback` | Accepts JSON (`question`, `answer`, `domain`, `level`). Returns `{ score, strengths, improvements, sampleAnswer }`. Skipped answers return score 0 immediately without calling AI. |

---

## 🛡️ Security & Reliability Features

- **No Disk Storage of Resumes**: Resume PDFs are held in volatile memory buffers by `multer.memoryStorage()` solely during text extraction, then discarded.
- **Key Safety**: The API key is loaded strictly on the server from `process.env.AI_API_KEY` and never exposed to the client or console logs.
- **Resilience**: 30-second request timeout with an automatic single retry on network/transient failure.
- **In-Memory Rate Limiting**: Capped at 20 requests per minute per IP to protect your API quota.
