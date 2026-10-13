# Stage 5 – Containerization
# Node serves the static app and the private Groq API proxy.
FROM node:22-alpine

# Build metadata (set by the CI pipeline; defaults make local builds work too)
ARG GIT_SHA=local
ARG BUILD_DATE=unknown

# Make the build args visible at runtime too
ENV GIT_SHA=$GIT_SHA
ENV BUILD_DATE=$BUILD_DATE

WORKDIR /app
COPY server.js team-server.js assistant.js visual-enhancements.js enhancements.css team.js team.css index.html package.json ./
COPY css/ ./css/
COPY js/ ./js/
ENV PORT=80

# Fallback version file (overwritten at startup with the real commit on Render)
RUN printf '{"commit":"%s","built":"%s"}\n' "$GIT_SHA" "$BUILD_DATE" > version.json

LABEL org.opencontainers.image.title="sprintboard" \
      org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.created="$BUILD_DATE"

EXPOSE 80

# Stage 8 – Docker marks the container "unhealthy" if / stops answering
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Write version.json at startup, preferring the commit Render provides, then start the app.
CMD ["sh", "-c", "printf '{\"commit\":\"%s\",\"built\":\"%s\"}\\n' \"${RENDER_GIT_COMMIT:-$GIT_SHA}\" \"$BUILD_DATE\" > version.json && exec node server.js"]
