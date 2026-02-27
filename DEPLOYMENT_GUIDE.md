# Deployment Guide

This project is configured for **Render** (Backend) and **Vercel** (Frontend).

## 1. Backend Deployment (Render)

1. **Connect Repository**: Push this code to GitHub and connect the repository to Render.
2. **Blueprint**: Render will automatically detect the `render.yaml` file at the root.
3. **Environment Variables**:
   - `OPENAI_API_KEY`: Your OpenAI key (required).
   - `FRONTEND_URL`: Your Vercel frontend URL (e.g., `https://your-app.vercel.app`) - required for CORS.
   - `NODE_ENV`: Set to `production`.
4. **Build Settings**: (Already in `render.yaml`)
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`

## 2. Frontend Deployment (Vercel)

1. **Connect Repository**: Connect the repository to Vercel.
2. **Root Directory**: Select the `frontend` folder.
3. **Framework Preset**: Select `Vite`.
4. **Environment Variables**:
   - `VITE_BACKEND_URL`: Your Render backend URL (e.g., `https://multilingual-conference-backend.onrender.com`).
5. **Build Settings**:
   - Build Command: `npm run build`
   - Output Directory: `dist`

## 3. Post-Deployment Verification

1. Open the Vercel URL.
2. Create a room and copy the Unique ID.
3. Open the URL in another tab/device and join using the Unique ID.
4. Verify that connections are established and translation services are working.
