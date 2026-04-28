# Etapa 1: Construcción (Build)
FROM node:20-alpine AS build
WORKDIR /app

# Copiamos solo package.json y package-lock.json primero para aprovechar el caché de Docker
COPY package*.json ./
RUN npm install

# Copiamos el resto del código y generamos el build de producción
COPY . .
RUN npm run build

# Etapa 2: Servidor Web (Nginx)
FROM nginx:alpine

# Copiamos la configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiamos los archivos compilados de Angular al directorio de Nginx
COPY --from=build /app/dist/app-front-sw1/browser /usr/share/nginx/html

# Exponemos el puerto 80 (el que Google Cloud Run usará por defecto si no le pasamos la variable PORT)
EXPOSE 80

# Comando para iniciar Nginx
CMD ["nginx", "-g", "daemon off;"]
