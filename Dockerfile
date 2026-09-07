# Serves the built site. The build runs on the developer's machine rather than
# in here, because the Maps key is injected at build time and the asset payload
# is 130MB — copying a finished `dist` is both faster and keeps the key out of
# any image layer that did not need it.
#
#   npm run build && fly deploy
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html

EXPOSE 8080
