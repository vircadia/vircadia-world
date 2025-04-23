<template>
  <div class="asset-example">
    <h2>Asset Example</h2>
    
    <input 
      v-model="assetFileName" 
      placeholder="Enter asset filename"
      class="asset-input"
    />
    
    <VircadiaAsset :fileName="assetFileName">
      <template #default="{ assetData, loading, error }">
        <div v-if="loading" class="asset-loading">
          Loading asset...
        </div>
        
        <div v-else-if="error" class="asset-error">
          Error loading asset: {{ error.message }}
        </div>
        
        <div v-else-if="assetData" class="asset-display">
          <div class="asset-info">
            <p><strong>Asset loaded:</strong> {{ assetFileName }}</p>
            <p><strong>Type:</strong> {{ assetData.type }}</p>
            <p><strong>Size:</strong> {{ (assetData.arrayBuffer.byteLength / 1024).toFixed(2) }} KB</p>
          </div>
          
          <!-- Display the asset based on its type -->
          <div class="asset-preview">
            <img 
              v-if="assetData.type.startsWith('image/')" 
              :src="assetData.url" 
              :alt="assetFileName"
              class="asset-image"
            />
            
            <audio 
              v-else-if="assetData.type.startsWith('audio/')" 
              :src="assetData.url" 
              controls
              class="asset-audio"
            ></audio>
            
            <video 
              v-else-if="assetData.type.startsWith('video/')" 
              :src="assetData.url" 
              controls
              class="asset-video"
            ></video>
            
            <div v-else class="asset-other">
              <p>Asset loaded but preview not available for this type.</p>
              <a :href="assetData.url" :download="assetFileName">Download File</a>
            </div>
          </div>
        </div>
        
        <div v-else class="asset-empty">
          Enter an asset filename to load
        </div>
      </template>
    </VircadiaAsset>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import VircadiaAsset from "../../../../../../sdk/vircadia-world-sdk-ts/module/client/framework/vue/component/VircadiaAsset.vue";

const assetFileName = ref("");
</script>

<style scoped>
.asset-example {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.asset-input {
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 20px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.asset-loading, 
.asset-error, 
.asset-empty {
  padding: 20px;
  text-align: center;
  background-color: #f5f5f5;
  border-radius: 4px;
  margin: 10px 0;
}

.asset-error {
  color: #d32f2f;
  background-color: #ffebee;
}

.asset-info {
  margin-bottom: 15px;
}

.asset-preview {
  border: 1px solid #ddd;
  padding: 15px;
  border-radius: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.asset-image {
  max-width: 100%;
  max-height: 400px;
}

.asset-audio, 
.asset-video {
  width: 100%;
}

.asset-other {
  text-align: center;
}
</style>