import React from "react";
import { Routes, Route } from "react-router-dom";
import Preview from "./feature/preview/preview";

import MeetingPage from "./feature/preview/MeetingPage";
import Feedback from "./feature/preview/Feedback";
import { ZoomProvider } from "./feature/preview/ZoomContext";

import "./App.css";

const App = () => {
  return (
    <ZoomProvider>
      <Routes>
        <Route path="/" element={<Preview />} />
        <Route path="/meeting" element={<MeetingPage />} />
        <Route path="/feedback" element={<Feedback />} />
      </Routes>
    </ZoomProvider>
  );
};

export default App;
