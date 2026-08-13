# IP Dashboard — Docker Deployment Guide

## Prerequisites
- Docker & Docker Compose installed
- Git (for cloning the project)
- A server (local, cloud VM, or Docker-capable hosting)

---

## Local Development with Docker

### 1. Clone & Setup

```bash
git clone <your-repo> ip-dashboard
cd ip-dashboard
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
nano .env
```

Update `.env`:
```
DATABASE_URL=postgresql://postgres:your_secure_password@postgres:5432/ip_dashboard
ADMIN_USER=admin
ADMIN_PASSWORD=your_secure_password
```

Also update `docker-compose.yml` line 13 with the same PostgreSQL password:
```yaml
POSTGRES_PASSWORD: your_secure_password_here
```

### 3. Start Everything

```bash
docker-compose up -d
```

This will:
- Pull/build images
- Start PostgreSQL (with automatic schema initialization)
- Start the Node.js app
- Wait for database to be healthy before starting app

### 4. Check Logs

```bash
# All services
docker-compose logs -f

# Just the app
docker-compose logs -f app

# Just the database
docker-compose logs -f postgres
```

### 5. Access the Dashboard

- **Dashboard**: http://localhost:3000
- **Admin Upload**: http://localhost:3000/admin
  - Username: `admin` (or what you set in `.env`)
  - Password: (what you set in `.env`)

### 6. Stop Everything

```bash
docker-compose down
```

To also remove the database volume:
```bash
docker-compose down -v
```

---

## Production Deployment (Cloud / VPS)

### Option A: Using Docker Compose (Simplest)

**On your server:**

```bash
# 1. SSH into your server
ssh user@your-server.com

# 2. Install Docker & Docker Compose (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 3. Clone your project
cd /opt
sudo git clone <your-repo> ip-dashboard
cd ip-dashboard

# 4. Set up environment
sudo cp .env.example .env
sudo nano .env
# Fill in real credentials (strong password!)

# 5. Update docker-compose.yml with production values
# (Same credentials as in .env)

# 6. Start services
sudo docker-compose up -d

# 7. Check status
sudo docker-compose ps
sudo docker-compose logs -f
```

### Option B: Using Nginx as Reverse Proxy (Recommended for Production)

**On your server:**

```bash
# 1. Install Nginx
sudo apt update
sudo apt install -y nginx

# 2. Create Nginx config
sudo nano /etc/nginx/sites-available/ip-dashboard
```

Paste this config:

```nginx
upstream app {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name yourdomain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL certificate (get with certbot/Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 25M;  # Allow file uploads up to 25MB

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

```bash
# 3. Enable the site
sudo ln -s /etc/nginx/sites-available/ip-dashboard /etc/nginx/sites-enabled/

# 4. Get SSL certificate (Let's Encrypt + Certbot)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com

# 5. Start Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# 6. Start Docker services (on port 3000 internally)
cd /opt/ip-dashboard
sudo docker-compose up -d
```

Now visit: `https://yourdomain.com`

---

## Database Management

### Access PostgreSQL from Host

```bash
# From your machine (if port 5432 exposed)
psql -h localhost -U postgres -d ip_dashboard

# Or via Docker
docker-compose exec postgres psql -U postgres -d ip_dashboard
```

### Backup Database

```bash
# Dump the database
docker-compose exec postgres pg_dump -U postgres ip_dashboard > backup.sql

# Restore from backup
docker-compose exec -T postgres psql -U postgres ip_dashboard < backup.sql
```

### View Logs

```bash
# App logs
docker-compose logs app --tail=50

# Database logs
docker-compose logs postgres --tail=50
```

---

## Monitoring & Maintenance

### Health Check

```bash
# Check container status
docker-compose ps

# Check app logs for errors
docker-compose logs app | grep -i error

# Test API
curl http://localhost:3000/api/companies
```

### Update Application

```bash
cd /opt/ip-dashboard

# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Verify
docker-compose logs app
```

### Resource Limits (Optional)

Add to `docker-compose.yml` under each service:

```yaml
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

---

## Troubleshooting

### "Connection refused" error
- Check if postgres container is running: `docker-compose ps`
- Verify DATABASE_URL in .env matches docker-compose.yml
- Check logs: `docker-compose logs postgres`

### "Port 3000 already in use"
```bash
docker ps  # Find what's using port 3000
docker stop <container-id>
# Or change port in docker-compose.yml: "3001:3000"
```

### Database not initialized
- Ensure `schema.sql` is in the project root
- Restart PostgreSQL: `docker-compose restart postgres`
- Check logs: `docker-compose logs postgres`

### File upload fails
- Check `client_max_body_size` in Nginx (should be ≥ 25M)
- Verify multer limits in `server/index.js`

---

## Summary of Key Commands

```bash
# Start
docker-compose up -d

# Logs
docker-compose logs -f app

# Stop
docker-compose down

# Rebuild (after code changes)
docker-compose build --no-cache
docker-compose up -d

# Database access
docker-compose exec postgres psql -U postgres -d ip_dashboard

# Backup
docker-compose exec postgres pg_dump -U postgres ip_dashboard > backup.sql
```

---

## Security Checklist

- ✅ Change `ADMIN_USER` and `ADMIN_PASSWORD` in `.env`
- ✅ Use strong PostgreSQL password
- ✅ Set `NODE_ENV=production`
- ✅ Enable HTTPS with valid SSL certificate (Let's Encrypt)
- ✅ Keep Docker images updated: `docker-compose pull`
- ✅ Backup database regularly
- ✅ Review logs for suspicious activity
- ✅ Use Nginx reverse proxy in production
- ✅ Restrict file upload size (already set to 20MB)
- ✅ Use VPS firewall to allow only necessary ports (80, 443)
