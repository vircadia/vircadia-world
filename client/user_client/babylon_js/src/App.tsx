import type { Component } from 'solid-js';
import styles from './App.module.css';
import GameScene from './components/GameScene';

const App: Component = () => {
  return (
    <div class={styles.App}>
      <GameScene />
    </div>
  );
};

export default App;
