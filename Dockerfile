# Stage 5 – Containerization
# Node serves the static app and the private Groq API proxy.
FROM node:22-alpine

# Build metadata (set by the CI pipeline; defaults make local builds work too)
ARG GIT_SHA=local
ARG BUILD_DATE=unknown

WORKDIR /app
COPY server.js team-server.js assistant.js visual-enhancements.js enhancements.css team.js team.css index.html package.json ./
COPY css/ ./css/
COPY js/ ./js/
ENV PORT=80

# Record which commit this image was built from (shown in the app footer and /version.json)
RUN printf '{"commit":"%s","built":"%s"}\n' "$GIT_SHA" "$BUILD_DATE" > version.json

LABEL org.opencontainers.image.title="sprintboard" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

EXPOSE 80

# Stage 8 – Docker marks the container "unhealthy" if /health stops answering
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the Sprintboard API and static file server.
CMD ["node", "server.js"]
