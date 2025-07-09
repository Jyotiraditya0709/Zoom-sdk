import React from "react";
import { Routes, Route } from "react-router-dom";
import Preview from "./feature/preview/preview";

import "./App.css";

const App = () => {
  return (
    <Routes>
      <Route path="/" element={<Preview />} />
    </Routes>
  );
};

export default App;
