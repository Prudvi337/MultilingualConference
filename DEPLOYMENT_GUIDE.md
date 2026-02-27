## 1. Backend Deployment (Render)

If you connect **only the `backend/` folder** to Render:
1. **Build Command**: Set to `npm install && npm run build` in the Render dashboard.
2. **Start Command**: Set to `npm start` in the Render dashboard.
3. **Environment Variables**: Set `OPENAI_API_KEY`, `FRONTEND_URL`, and `NODE_ENV=production`.

If you connect the **whole repository root** to Render:
1. **Blueprint**: Render will automatically detect the `render.yaml` at the root. (Note: I have currently placed it inside `backend/` since you connected that folder directly).

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
