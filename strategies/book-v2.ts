import { createBookImbalanceStrategy } from '../src/index.js';
export default createBookImbalanceStrategy({ name: 'book-v2', threshold: 0.7, topLevels: 5 });
