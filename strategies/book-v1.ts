import { createBookImbalanceStrategy } from '../src/index.js';
export default createBookImbalanceStrategy({ name: 'book-v1', threshold: 0.6, topLevels: 5 });
