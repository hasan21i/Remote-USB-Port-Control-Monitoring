# Zero-Trust USB Peripheral Control and Forensic Monitoring Framework

An end-to-end Zero-Trust security framework for Windows endpoints designed to prevent unauthorized USB device access, BadUSB attacks, and hardware-level tampering through pre-mount registry inspection, OS-level Plug-and-Play (PnP) isolation, Generative AI incident triage, and tamper-evident cryptographic logging.

---

## 🏛 System Architecture & Components

The framework consists of four primary modules:

```
├── backend/            # Core Backend Service (Flask, PnP Controller, Blockchain & AI Engine)
├── frontend/           # Centralized Web Management Dashboard (React / Vite)
├── USB-Agent-App/      # Windows Endpoint Desktop Agent (Electron)
└── remot/              # Mobile Administrator Application (Flutter cross-platform)
```

### 1. `backend/` — Core Security Engine & REST API
* **Pre-Mount Hardware Isolation:** Fast polling (`20ms` registry event monitoring) and Windows PnP cascade enforcement (`pnputil`, WMI `Win32_PnPEntity.Disable()`, PowerShell `Disable-PnpDevice`) to disable unauthorized devices before file-system mount.
* **Zero-Trust Multi-Attribute Fingerprinting:** Validates device identity against unauthorized spoofing using combined attributes (`Vendor ID`, `Product ID`, `Hardware Serial Number`, `DeviceInstanceId`).
* **AI-Assisted Incident Triage:** Automated incident report generation and classification (`Allow`, `Block`, `Review`) via LLM reasoning engines.
* **Tamper-Evident Blockchain Ledger:** Cryptographically chained blocks (SHA-256 + Proof-of-Work difficulty target) with Fernet encryption and off-host log replication for verifiable forensic integrity.

### 2. `frontend/` — Web Management Dashboard
* Real-time USB monitoring, active device inventory, and status indicators.
* Whitelist and Blacklist management with instant policy synchronization.
* Visual incident reports and cryptographic blockchain ledger verification.

### 3. `USB-Agent-App/` — Endpoint Desktop Agent
* Native Windows background service responsible for low-level device state detection and local notification dispatching.
* Communicates directly with the backend controller for real-time policy evaluation.

### 4. `remot/` — Mobile Management Console
* Flutter-based mobile application allowing security administrators to review alerts, approve or block pending devices remotely, and inspect audit logs.

---

## 🚀 Quick Start Guide

### Prerequisites
* Windows 10/11 (Administrator privileges required for PnP hardware control)
* Python 3.10+
* Node.js 18+ & npm
* Flutter SDK (for mobile client compilation)

### 1. Running the Backend Service
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
*The backend API initializes on `http://localhost:5000`.*

### 2. Running the Web Management Dashboard
```bash
cd frontend
npm install
npm run dev
```
*The management console will be accessible on `http://localhost:3000`.*

### 3. Running the Endpoint Desktop Agent
```bash
cd USB-Agent-App
npm install
npm start
```

### 4. Running the Mobile Application
```bash
cd remot
flutter pub get
flutter run
```

---

## 🔒 Security Design Principles

1. **Explicit Device Verification:** No device is trusted by default. Peripherals are matched against explicit policy rules using multi-factor hardware descriptors.
2. **Rapid Enforcement Loop:** Device discovery operates at the registry layer before driver stack enumeration and volume mounting complete.
3. **Forensic Integrity:** Log entries are immutable, sequentially hashed, and continuously verifiable against tampering.
