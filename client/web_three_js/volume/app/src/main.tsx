import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import AppWithVircadia from "./AppWithVircadia.tsx";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <AppWithVircadia />
    </StrictMode>,
);
