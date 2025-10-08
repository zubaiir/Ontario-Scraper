FROM apify/actor-node-playwright-chrome:20

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy everything
COPY . ./

# Run the JavaScript file directly
CMD ["node", "src/main.js"]