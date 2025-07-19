#!/bin/bash

# Before first commit, this applies permissions that persist in git:
# git update-index --chmod=+x yourscript.sh

# In order to run with pm2 and env vars you need:
# npm install -g dotenv-cli

# Copy and run this PM2 command:
# pm2 start ./pm2start.sh --name digiful

dotenv npm run start