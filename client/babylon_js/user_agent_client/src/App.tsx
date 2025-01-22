import type { Component } from "solid-js";
import styles from "./App.module.css";
import WorldScene from "./components/WorldScene";

const App: Component = () => {
    return (
        <div class={styles.App}>
            <WorldScene />
        </div>
    );
};

export default App;
