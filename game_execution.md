# Eyes on Me - Starten des Projekts

Du kannst das Projekt ganz einfach starten.

## Methode 1: Automatischer Start (Empfohlen)

### Unter Windows:
Führe einfach die Datei **`start_game.bat`** im Hauptverzeichnis des Projekts aus (z.B. per Doppelklick).
Diese startet automatisch:
1. Das **Backend** (API-Server) in einem separaten Terminal.
2. Das **Frontend** (Vite-Entwicklungsserver) in einem separaten Terminal (inklusive automatischer Einbindung der portablen Node.js v22 Version).

### Unter Linux / macOS:
Führe das Bash-Skript im Hauptverzeichnis aus:
```bash
chmod +x start_game.sh
./start_game.sh
```
Dieses startet beide Server im Hintergrund und beendet sie sauber wieder, sobald du **`Ctrl+C`** drückst.

Sobald beide Server laufen, kannst du das Spiel über diese URL starten:
**[http://localhost:5173/?p1demo](http://localhost:5173/?p1demo)**

---

## Methode 2: Manueller Start über separate Terminals

Falls du die Server manuell starten möchtest, öffne zwei Terminals im Hauptverzeichnis des Projekts (`eyes-on-me`) und gib die folgenden Befehle der Reihe nach ein:

### Terminal 1: Backend (API-Server)
```bash
cd backend
.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Terminal 2: Frontend (Entwicklungsserver)
Hier nutzen wir die portable Node-Version aus dem Projektordner:
```cmd
cd frontend
set PATH=..\temp\node-v22.23.1-win-x64;%PATH%
npm run dev
```

Das Spiel läuft danach wie gewohnt unter **[http://localhost:5173/?p1demo](http://localhost:5173/?p1demo)**.