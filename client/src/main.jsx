import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { loadIceConfig } from "./lib/ice.js";
import "./index.css";

loadIceConfig();

createRoot(document.getElementById("root")).render(<App />);
