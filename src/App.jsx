import React from "react";
import { Routes, Route } from "react-router-dom";
import Preview from "./feature/preview/preview";
import BlurPreview from "./feature/preview/BlurPreview";
import MeetingPage from "./feature/preview/MeetingPage";
import { ZoomProvider } from "./feature/preview/ZoomContext";

import "./App.css";

const App = () => {
  return (
    <ZoomProvider>
      <Routes>
        <Route path="/" element={<Preview />} />
        <Route path="/blur" element={<BlurPreview />} />
        <Route path="/meeting" element={<MeetingPage />} />
      </Routes>
    </ZoomProvider>
  );
};

export default App;
