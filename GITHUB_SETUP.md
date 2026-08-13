# GitHub + Docker Deployment Setup

Complete guide to set up CI/CD with GitHub Actions and deploy to your server.

---

## Step 1: Create GitHub Repository

### Option A: If you already have a GitHub account

```bash
# Go to https://github.com/new
# Create a new repository called "ip-dashboard"
# Do NOT initialize with README (we already have one)
# Click "Create repository"
```

### Option B: First time with GitHub

1. Go to [https://github.com/signup](https://github.com/signup)
2. Create an account
3. Go to [https://github.com/new](https://github.com/new)
4. Fill in:
   - **Repository name**: `ip-dashboard`
   - **Description**: "EV Battery IP Valuation Dashboard"
   - **Visibility**: Private (optional, for security)
   - Leave other options default
5. Click **"Create repository"**

---

## Step 2: Push Your Code to GitHub

```bash
cd h:\ip-dashboard

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: IP Dashboard with Docker"

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/ip-dashboard.git

# Push to main branch
git branch -M main
git push -u origin main
```

You'll be prompted for credentials. Use:
- **Username**: Your GitHub username
- **Password**: A Personal Access Token (PAT) — see below

### Generate GitHub Personal Access Token (PAT)

1. Go to: https://github.com/settings/tokens/new
2. Fill in:
   - **Note**: "IP Dashboard Deploy"
   - **Expiration**: 90 days (or custom)
   - **Scopes**: Check ✅
     - `repo` (full control of private repositories)
     - `write:packages` (push Docker images)
     - `read:packages` (pull Docker images)
3. Click **"Generate token"**
4. **Copy the token** (you won't see it again!)
5. Use this as your password when pushing to GitHub

---

## Step 3: Set Up SSH Key for Server Deployment

### On Your Local Machine (Windows PowerShell)

```powershell
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\github_deploy" -N ""

# Copy the private key content
Get-Content "$env:USERPROFILE\.ssh\github_deploy" | Set-Clipboard
```

**On Mac/Linux:**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy | pbcopy  # macOS
cat ~/.ssh/github_deploy | xclip -selection clipboard  # Linux
```

### On Your Server (SSH)

```bash
ssh user@your-server.com

# Create SSH directory if it doesn't exist
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Add your public key
nano ~/.ssh/authorized_keys
# Paste the content of: ~/.ssh/github_deploy.pub from your local machine
# Save (Ctrl+O, Enter, Ctrl+X)

chmod 600 ~/.ssh/authorized_keys
```

---

## Step 4: Add GitHub Secrets

GitHub Secrets are encrypted environment variables used by Actions. They're never exposed in logs or code.

### Go to Your Repository Settings

1. Navigate to: https://github.com/YOUR_USERNAME/ip-dashboard/settings/secrets/actions
2. Click **"New repository secret"** and add each:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `SERVER_HOST` | `your-server.com` or IP | Your server's hostname or IP address |
| `SERVER_USER` | `ubuntu` or your username | SSH username for your server |
| `SERVER_SSH_KEY` | (paste private key) | Entire content of `~/.ssh/github_deploy` |

**Example for SERVER_SSH_KEY:**
```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUtbm9uZS1ub25lAAAAAAAAAF...
... (many lines) ...
-----END OPENSSH PRIVATE KEY-----
```

**Screenshots path:**
```
GitHub Repo → Settings → Security → Secrets and variables → Actions → New repository secret
```

---

## Step 5: Prepare Your Server

### SSH into Your Server

```bash
ssh user@your-server.com

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose
curl -fsSL https://get.docker.com | sudo sh
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create app directory
sudo mkdir -p /opt/ip-dashboard
cd /opt/ip-dashboard

# Initialize git repo to pull from GitHub
sudo git init
sudo git remote add origin https://github.com/YOUR_USERNAME/ip-dashboard.git
sudo git config user.email "deploy@yourdomain.com"
sudo git config user.name "Deploy Bot"

# First pull (will prompt for credentials)
sudo git pull origin main

# Fix permissions
sudo chown -R $USER:$USER /opt/ip-dashboard

# Create .env file
cp .env.example .env
nano .env
# Fill in:
#   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@postgres:5432/ip_dashboard
#   ADMIN_USER=admin
#   ADMIN_PASSWORD=YOUR_SECURE_PASSWORD
# Save (Ctrl+O, Enter, Ctrl+X)

# Update docker-compose.yml with same password
nano docker-compose.yml
# Change line 13: POSTGRES_PASSWORD: YOUR_PASSWORD (same as .env)
# Save

# Start services (first time)
docker-compose up -d

# Check logs
docker-compose logs -f app
```

**On Ubuntu**, you may need to add your user to the docker group:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

---

## Step 6: Create Deployment Script on Server

On your server, create an auto-update script:

```bash
sudo nano /opt/ip-dashboard/deploy.sh
```

Paste this:

```bash
#!/bin/bash
set -e

cd /opt/ip-dashboard

echo "🔄 Pulling latest code..."
git pull origin main

echo "🐋 Logging into GitHub Container Registry..."
echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin

echo "⬇️  Pulling latest images..."
docker-compose pull

echo "🚀 Starting services..."
docker-compose up -d

echo "✅ Deployment complete!"
docker-compose logs app --tail=20
```

Make it executable:
```bash
sudo chmod +x /opt/ip-dashboard/deploy.sh
```

This script is automatically called by GitHub Actions on every push to `main`.

---

## Step 7: How It All Works

### Workflow on Every Push to `main`:

```
You push code to GitHub
    ↓
GitHub Actions triggers
    ↓
Builds Docker image
    ↓
Pushes to GitHub Container Registry (ghcr.io)
    ↓
SSH into your server
    ↓
Runs deploy.sh (pulls latest image, restarts containers)
    ↓
✅ Your app is live with the latest code!
```

### Workflow Diagram

```
Your Computer
    ↓
git push origin main
    ↓
GitHub Repository
    ↓
GitHub Actions Workflow (.github/workflows/build-and-deploy.yml)
    ├─ Build job: Builds Docker image, pushes to ghcr.io
    └─ Deploy job: SSH to server, runs docker-compose up
    ↓
Your Server
    ├─ Git pulls latest code
    ├─ Docker pulls latest image from ghcr.io
    ├─ docker-compose up -d (restart if needed)
    └─ App is live!
```

---

## Step 8: Test the Deployment

### Trigger a Build Manually

1. Go to: https://github.com/YOUR_USERNAME/ip-dashboard/actions
2. Click **"Build & Deploy to Server"**
3. Click **"Run workflow"** → **"Run workflow"** (green button)
4. Watch the build progress
5. If successful, your server will auto-update

### Check Logs

**On GitHub:**
- Go to Actions tab
- Click the latest workflow run
- See build status and deployment logs

**On Your Server:**
```bash
ssh user@your-server.com
cd /opt/ip-dashboard
docker-compose logs app --tail=50
```

---

## Step 9: Continuous Deployment Setup Complete! 🎉

Now every time you:

```bash
git add .
git commit -m "Fix: some bug or feature"
git push origin main
```

It will automatically:
1. ✅ Build your Docker image
2. ✅ Push to GitHub Container Registry
3. ✅ Deploy to your server
4. ✅ Restart the app with new code

---

## Common Workflow

### Making Changes

```bash
# On your local machine
cd h:\ip-dashboard

# Make code changes (e.g., client/src/App.jsx)

# Test locally (optional)
npm start  # if not using Docker

# Commit and push
git add .
git commit -m "Feature: add new dashboard section"
git push origin main

# GitHub Actions will auto-deploy!
# Check: https://github.com/YOUR_USERNAME/ip-dashboard/actions
```

### Checking Server Status

```bash
ssh user@your-server.com
cd /opt/ip-dashboard

# See running containers
docker-compose ps

# See recent logs
docker-compose logs app --tail=30

# Full logs
docker-compose logs

# Stop/restart manually if needed
docker-compose restart app
```

---

## Troubleshooting

### "Permission denied (publickey)" on GitHub Actions deploy

**Problem**: SSH key isn't recognized on server.

**Fix**:
```bash
# On server, check authorized_keys
cat ~/.ssh/authorized_keys

# Verify permissions
ls -la ~/.ssh
# Should be: drwx------ (700) for .ssh
#            -rw------- (600) for authorized_keys
```

### "No such file or directory: /opt/ip-dashboard"

**Fix**: Create the directory on server first
```bash
sudo mkdir -p /opt/ip-dashboard
sudo git clone https://github.com/YOUR_USERNAME/ip-dashboard.git /opt/ip-dashboard
cd /opt/ip-dashboard
# Continue with .env setup
```

### GitHub Actions fails: "GITHUB_TOKEN permission denied"

**Fix**: Go to repo Settings → Actions → General → Workflow permissions
- Select: "Read and write permissions"
- Click Save

### Docker image won't pull: "unknown: User not authorized"

**Fix**: GHCR requires authentication
```bash
# On server
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

---

## Security Best Practices

✅ **Secrets**: Never commit `.env` file — it's in `.gitignore`
✅ **SSH Key**: Never share private key — only public key on server
✅ **GitHub Token**: Use PAT with minimal required scopes
✅ **Server Access**: Restrict SSH to specific IPs if possible
✅ **HTTPS**: Use domain with SSL certificate
✅ **Backups**: Regularly backup your database

---

## Next Steps

1. ✅ Create GitHub repository
2. ✅ Push code
3. ✅ Add SSH key
4. ✅ Add repository secrets
5. ✅ Prepare server
6. ✅ Test deployment
7. ✅ Monitor & maintain

You're all set! 🚀 Every push to GitHub is now auto-deployed to your server.
