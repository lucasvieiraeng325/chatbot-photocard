# Running the bot for free on Oracle Cloud (Always Free)

Oracle's console changes often; if a button has a slightly different name, look for the closest match.

## 1. Create the account

1. Go to **oracle.com/cloud/free** and click **Start for free**.
2. Country: **Brazil**. Fill in your name and e-mail, then confirm the e-mail.
3. **Home Region:** choose **Brazil East (São Paulo)** or **Brazil Southeast (Vinhedo)**.
   ⚠️ It **cannot be changed later**, and Always Free machines can only be created in it.
4. Add a credit card. It's only for identity verification: a small temporary hold may appear and is released. Nothing is charged while you only use "Always Free" resources.
5. Wait for the "account is ready" e-mail (from a few minutes to a few hours).

> If the sign-up is refused, try again with the card holder's exact name and address, without a VPN, or use the Google Cloud e2-micro alternative.

## 2. (Recommended) Avoid the machine being reclaimed for being idle

Oracle may **reclaim Always Free machines that stay idle** (very low CPU/network/memory for 7 days), and a WhatsApp bot is idle most of the time. Accounts on **Pay As You Go** are not subject to this, and they **keep the Always Free resources free**:

1. Console → menu ☰ → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade to Pay As You Go**.
2. Then go to **Billing & Cost Management** → **Budgets** → **Create Budget**: a monthly budget of **US$ 1** with an alert to your e-mail at 1%. If anything ever starts costing money, you'll know right away.

As long as you only create what this guide shows (marked "Always Free-eligible"), the bill stays at R$ 0.

## 3. Create the virtual machine

Menu ☰ → **Compute** → **Instances** → **Create instance**:

| Field | What to choose |
|---|---|
| **Name** | `photocard-bot` |
| **Image** | **Change image** → **Canonical Ubuntu** → **24.04** |
| **Shape** | **Change shape** → **Ampere** → **VM.Standard.A1.Flex**, with **1 OCPU** and **6 GB** of memory (the label "Always Free-eligible" must appear) |
| **Networking** | "Create new virtual cloud network" and "Create new public subnet" (the defaults); **Assign a public IPv4 address: Yes** |
| **Add SSH keys** | **Generate a key pair for me** → click **Save private key** (a `ssh-key-….key` file is downloaded; **keep it safe**, it's your machine's password) |
| **Boot volume** | leave the default |

Click **Create**. In 1–2 minutes the status changes to **Running**. Copy the **Public IP address**.

> **"Out of capacity for shape VM.Standard.A1.Flex"?** It's common in Brazilian regions. Either try again later or in another "Availability domain", or use the **VM.Standard.E2.1.Micro** shape (AMD, 1 GB RAM, also Always Free; it's enough for the bot, see step 5.1).

No firewall port needs to be opened: the bot only makes outbound connections (WhatsApp and Mercado Pago).

## 4. Connect to the machine

The user is **`ubuntu`** (not root).

**Windows (PowerShell):**

```powershell
icacls "$HOME\Downloads\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

```powershell
ssh -i "$HOME\Downloads\ssh-key.key" ubuntu@PUBLIC_IP
```

(Use the real name of the downloaded file, e.g. `ssh-key-2026-11-20.key`.)

**Mac / Linux:**

```bash
chmod 400 ~/Downloads/ssh-key-*.key
```

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@PUBLIC_IP
```

Answer `yes` to the first question. You're in when the prompt `ubuntu@photocard-bot:~$` appears.

## 5. Install the bot

### 5.1 (Only if you used the E2.1.Micro, 1 GB of RAM) create swap memory

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 5.2 Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/lucasvieiraeng325/chatbot-photocard/main/deploy/instalar.sh -o instalar.sh
```

```bash
bash instalar.sh
```

> **Private repository:** the `curl` above returns 404. Create the file by hand instead: `nano instalar.sh`, paste the contents of `deploy/instalar.sh` from GitHub, then save with Ctrl+O, Enter, Ctrl+X. When the script downloads the repository, use your GitHub username and a **token** as the password (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained, with "Contents: Read-only" on this repository).

The script asks for:
- the Mercado Pago **production Access Token** (`APP_USR-...`);
- the bot's **WhatsApp number** (`55` + area code + number);
- the numbers that get **sale alerts** (optional).

## 6. Connect WhatsApp

> ⚠️ First turn off any other running copy of the bot using the same number.

```bash
pm2 logs photocard-bot
```

An **8-letter code** appears. On the bot's phone, go to **WhatsApp → Linked devices → Link a device → Link with phone number instead** and type the code. When **"✅ WhatsApp conectado"** appears, press `Ctrl+C`; the bot keeps running.

Test it by sending "oi" to the bot from another phone.

## 7. Day to day

| To… | Command (inside `~/chatbot-photocard`) |
|---|---|
| see what's happening | `pm2 logs photocard-bot` |
| publish new PDFs or changes from GitHub | `bash deploy/atualizar.sh` |
| change prices or names right on the server | `nano catalog.json`, then `pm2 restart photocard-bot` |
| see orders | `cat data/db.json` |

The bot restarts on its own if it crashes or the machine reboots.

**Backup:** the `data/` folder holds the WhatsApp session and the orders. Back it up now and then (from your computer):

```bash
scp -i ~/Downloads/ssh-key-*.key -r ubuntu@PUBLIC_IP:~/chatbot-photocard/data ./backup-bot
```
