const SIZE = 9;
const STORAGE_KEY = "stillspace-sudoku-v1";
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

const elements = {
  board: document.querySelector("#sudoku-board"),
  numberButtons: document.querySelector("#number-buttons"),
  timer: document.querySelector("#timer"),
  heading: document.querySelector("#game-heading"),
  message: document.querySelector("#game-message"),
  difficulty: document.querySelector("#difficulty"),
  clues: document.querySelector("#clue-count"),
  filled: document.querySelector("#filled-count"),
  hints: document.querySelector("#hint-count"),
  notesButton: document.querySelector("#notes-button"),
  dialog: document.querySelector("#import-dialog"),
  uploadStep: document.querySelector("#upload-step"),
  cropStep: document.querySelector("#crop-step"),
  reviewStep: document.querySelector("#review-step"),
  imageInput: document.querySelector("#image-input"),
  dropZone: document.querySelector("#drop-zone"),
  cameraButton: document.querySelector("#open-camera"),
  cameraPanel: document.querySelector("#camera-panel"),
  cameraVideo: document.querySelector("#camera-video"),
  capturePhotoButton: document.querySelector("#capture-photo"),
  cropCanvas: document.querySelector("#crop-canvas"),
  scanButton: document.querySelector("#scan-image-button"),
  reviewGrid: document.querySelector("#review-grid"),
  reviewSummary: document.querySelector("#review-summary"),
  reviewWarning: document.querySelector("#review-warning"),
  startPhotoGame: document.querySelector("#start-photo-game"),
};

let solution = [];
let puzzle = [];
let values = [];
let fixed = [];
let notes = [];
let selected = 40;
let noteMode = false;
let showErrors = false;
let hintCount = 0;
let elapsedSeconds = 0;
let completed = false;
let importedValues = [];
let selectedDifficulty = "medium";
let cropImage = null;
let cropRect = null;
let cropDragStart = null;
let cameraStream = null;
let ocrWorker = null;
let ocrScriptPromise = null;
let timerInterval = null;

function shuffled(items) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function rowOf(index) { return Math.floor(index / SIZE); }
function colOf(index) { return index % SIZE; }
function boxOf(index) { return `${Math.floor(rowOf(index) / 3)}:${Math.floor(colOf(index) / 3)}`; }

function candidatesFor(board, index) {
  const row = rowOf(index);
  const col = colOf(index);
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  const used = new Set();
  for (let offset = 0; offset < SIZE; offset += 1) {
    used.add(board[row * SIZE + offset]);
    used.add(board[offset * SIZE + col]);
  }
  for (let r = boxRow; r < boxRow + 3; r += 1) {
    for (let c = boxCol; c < boxCol + 3; c += 1) used.add(board[r * SIZE + c]);
  }
  return Array.from({ length: SIZE }, (_, i) => i + 1).filter((digit) => !used.has(digit));
}

function solveSudoku(start, maxSolutions = 1) {
  const working = [...start];
  const solutions = [];
  let visited = 0;
  const visit = () => {
    visited += 1;
    if (visited > 750_000 || solutions.length >= maxSolutions) return;
    let bestIndex = -1;
    let bestOptions = null;
    for (let index = 0; index < working.length; index += 1) {
      if (working[index] !== 0) continue;
      const options = candidatesFor(working, index);
      if (options.length === 0) return;
      if (bestOptions === null || options.length < bestOptions.length) {
        bestIndex = index;
        bestOptions = options;
        if (options.length === 1) break;
      }
    }
    if (bestIndex === -1) {
      solutions.push([...working]);
      return;
    }
    for (const digit of bestOptions) {
      working[bestIndex] = digit;
      visit();
      working[bestIndex] = 0;
      if (solutions.length >= maxSolutions || visited > 750_000) return;
    }
  };
  visit();
  return { solutions, exhausted: visited > 750_000 };
}

function fillRandomBoard(board) {
  let bestIndex = -1;
  let bestOptions = null;
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== 0) continue;
    const options = candidatesFor(board, index);
    if (options.length === 0) return false;
    if (bestOptions === null || options.length < bestOptions.length) {
      bestIndex = index;
      bestOptions = options;
      if (options.length === 1) break;
    }
  }
  if (bestIndex === -1) return true;
  for (const digit of shuffled(bestOptions)) {
    board[bestIndex] = digit;
    if (fillRandomBoard(board)) return true;
    board[bestIndex] = 0;
  }
  return false;
}

function makePuzzle(difficulty) {
  const completeBoard = Array(SIZE * SIZE).fill(0);
  fillRandomBoard(completeBoard);
  const puzzleBoard = [...completeBoard];
  const cluesByDifficulty = { easy: 40, medium: 33, hard: 28 };
  const clues = cluesByDifficulty[difficulty] ?? cluesByDifficulty.medium;
  const cellsToClear = shuffled(Array.from({ length: 81 }, (_, index) => index)).slice(0, 81 - clues);
  for (const index of cellsToClear) puzzleBoard[index] = 0;
  return { solution: completeBoard, puzzle: puzzleBoard };
}

function sameRowOrColumnOrBox(a, b) {
  return rowOf(a) === rowOf(b) || colOf(a) === colOf(b) || boxOf(a) === boxOf(b);
}

function duplicateCells(board) {
  const duplicates = new Set();
  for (let index = 0; index < board.length; index += 1) {
    const digit = board[index];
    if (!digit) continue;
    for (let other = index + 1; other < board.length; other += 1) {
      if (board[other] === digit && sameRowOrColumnOrBox(index, other)) {
        duplicates.add(index);
        duplicates.add(other);
      }
    }
  }
  return duplicates;
}

function setMessage(message, style = "") {
  elements.message.textContent = message;
  elements.message.className = `game-message${style ? ` is-${style}` : ""}`;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startTimer() {
  window.clearInterval(timerInterval);
  timerInterval = window.setInterval(() => {
    if (completed) return;
    elapsedSeconds += 1;
    elements.timer.textContent = formatTime(elapsedSeconds);
    saveGame();
  }, 1000);
}

function updateStats() {
  const clueCount = fixed.filter(Boolean).length;
  const filledCount = values.reduce((count, value, index) => count + (value && !fixed[index] ? 1 : 0), 0);
  elements.clues.textContent = String(clueCount);
  elements.filled.innerHTML = `${filledCount} <small>/ ${81 - clueCount}</small>`;
  elements.hints.textContent = String(hintCount);
  for (const button of elements.numberButtons.querySelectorAll("button")) {
    const digit = Number(button.dataset.digit);
    const remaining = values.reduce((count, value) => count + (value === digit ? 1 : 0), 0);
    button.disabled = completed || remaining >= 9;
    button.setAttribute("aria-label", `${digit}, ${9 - remaining} remaining`);
  }
}

function renderBoard() {
  const duplicates = duplicateCells(values);
  const selectedValue = values[selected];
  elements.board.replaceChildren();
  for (let index = 0; index < 81; index += 1) {
    const button = document.createElement("button");
    const row = rowOf(index);
    const col = colOf(index);
    const digit = values[index];
    button.type = "button";
    button.className = "sudoku-cell";
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `Row ${row + 1}, column ${col + 1}, ${digit || "blank"}${fixed[index] ? ", original clue" : ""}${selected === index ? ", selected" : ""}`);
    if (fixed[index]) button.classList.add("is-fixed");
    if (selected !== index && sameRowOrColumnOrBox(index, selected)) button.classList.add("is-peer");
    if (digit && selectedValue === digit && selected !== index) button.classList.add("is-same");
    if (selected === index) button.classList.add("is-selected");
    if (duplicates.has(index)) button.classList.add("is-conflict");
    if (showErrors && digit && !fixed[index] && digit !== solution[index]) button.classList.add("is-error");
    if (digit) {
      button.textContent = String(digit);
    } else if (notes[index].size > 0) {
      const noteGrid = document.createElement("span");
      noteGrid.className = "cell-notes";
      for (let value = 1; value <= 9; value += 1) {
        const note = document.createElement("span");
        note.textContent = notes[index].has(value) ? String(value) : "";
        noteGrid.append(note);
      }
      button.append(noteGrid);
    }
    button.disabled = completed;
    elements.board.append(button);
  }
  updateStats();
}

function saveGame() {
  if (!solution.length) return;
  const payload = {
    solution, puzzle, values, fixed,
    notes: notes.map((set) => [...set]),
    selected, selectedDifficulty, elapsedSeconds, hintCount, showErrors, completed,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch { /* Private browsing may disable storage. */ }
}

function loadSavedGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || ![saved.solution, saved.puzzle, saved.values, saved.fixed].every((list) => Array.isArray(list) && list.length === 81)) return false;
    solution = saved.solution;
    puzzle = saved.puzzle;
    values = saved.values;
    fixed = saved.fixed;
    notes = Array.isArray(saved.notes) && saved.notes.length === 81 ? saved.notes.map((set) => new Set(set)) : Array.from({ length: 81 }, () => new Set());
    selected = Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < 81 ? saved.selected : 40;
    selectedDifficulty = saved.selectedDifficulty || "medium";
    elapsedSeconds = Number(saved.elapsedSeconds) || 0;
    hintCount = Number(saved.hintCount) || 0;
    showErrors = Boolean(saved.showErrors);
    completed = Boolean(saved.completed);
    elements.difficulty.value = selectedDifficulty;
    elements.heading.textContent = selectedDifficulty === "imported" ? "From your photo" : `${selectedDifficulty[0].toUpperCase()}${selectedDifficulty.slice(1)} puzzle`;
    return true;
  } catch {
    return false;
  }
}

function beginGame(nextPuzzle, nextSolution, difficulty) {
  puzzle = [...nextPuzzle];
  solution = [...nextSolution];
  values = [...nextPuzzle];
  fixed = nextPuzzle.map((digit) => digit !== 0);
  notes = Array.from({ length: 81 }, () => new Set());
  selected = values.findIndex((digit, index) => !digit && index >= 36 && index <= 44);
  if (selected < 0) selected = values.findIndex((digit) => !digit);
  if (selected < 0) selected = 40;
  selectedDifficulty = difficulty;
  noteMode = false;
  showErrors = false;
  hintCount = 0;
  elapsedSeconds = 0;
  completed = false;
  elements.notesButton.setAttribute("aria-pressed", "false");
  elements.difficulty.value = difficulty;
  elements.heading.textContent = difficulty === "imported" ? "From your photo" : `${difficulty[0].toUpperCase()}${difficulty.slice(1)} puzzle`;
  elements.timer.textContent = "00:00";
  setMessage("Choose a square to begin.");
  renderBoard();
  saveGame();
  startTimer();
}

function newGame(difficulty = elements.difficulty.value) {
  if (difficulty === "imported") {
    openImportDialog();
    return;
  }
  const game = makePuzzle(difficulty);
  beginGame(game.puzzle, game.solution, difficulty);
}

function finishIfSolved() {
  if (!values.every((digit, index) => digit === solution[index])) return false;
  completed = true;
  window.clearInterval(timerInterval);
  renderBoard();
  setMessage(`Lovely work. You finished in ${formatTime(elapsedSeconds)}.`, "success");
  saveGame();
  return true;
}

function enterDigit(digit) {
  if (completed || fixed[selected]) return;
  if (noteMode && values[selected] === 0) {
    if (notes[selected].has(digit)) notes[selected].delete(digit);
    else notes[selected].add(digit);
  } else {
    values[selected] = digit;
    notes[selected].clear();
    showErrors = false;
    if (!finishIfSolved()) setMessage(duplicateCells(values).size ? "A number repeats in the same row, column, or square." : "A digit at a time.", duplicateCells(values).size ? "warning" : "");
  }
  renderBoard();
  saveGame();
}

function eraseSelected() {
  if (completed || fixed[selected]) return;
  values[selected] = 0;
  notes[selected].clear();
  showErrors = false;
  setMessage("Square cleared.");
  renderBoard();
  saveGame();
}

function moveSelection(rowDelta, colDelta) {
  const row = Math.max(0, Math.min(8, rowOf(selected) + rowDelta));
  const col = Math.max(0, Math.min(8, colOf(selected) + colDelta));
  selected = row * 9 + col;
  renderBoard();
}

function useHint() {
  if (completed) return;
  const emptyCells = values.map((value, index) => ({ value, index })).filter(({ value, index }) => !value && !fixed[index]);
  if (!emptyCells.length) {
    setMessage("There are no empty squares left.", "warning");
    return;
  }
  const selectedCell = emptyCells.find(({ index }) => index === selected);
  const { index } = selectedCell || emptyCells[Math.floor(Math.random() * emptyCells.length)];
  values[index] = solution[index];
  notes[index].clear();
  selected = index;
  hintCount += 1;
  setMessage("A little nudge in the right direction.");
  if (!finishIfSolved()) renderBoard();
  saveGame();
}

function checkBoard() {
  if (completed) return;
  showErrors = true;
  const duplicates = duplicateCells(values);
  const wrongCells = values.reduce((count, digit, index) => count + (digit && !fixed[index] && digit !== solution[index] ? 1 : 0), 0);
  if (values.every((digit, index) => digit === solution[index])) finishIfSolved();
  else if (duplicates.size) setMessage("Highlighted numbers share a row, column, or square.", "warning");
  else if (wrongCells) setMessage(`${wrongCells} ${wrongCells === 1 ? "digit needs" : "digits need"} a second look.`, "warning");
  else setMessage("So far, so good. Keep going.", "success");
  renderBoard();
  saveGame();
}

function buildNumberPad() {
  elements.numberButtons.replaceChildren();
  for (let digit = 1; digit <= 9; digit += 1) {
    const button = document.createElement("button");
    button.className = "number-button";
    button.type = "button";
    button.textContent = String(digit);
    button.dataset.digit = String(digit);
    elements.numberButtons.append(button);
  }
}

function showImportStep(step) {
  elements.uploadStep.hidden = step !== "upload";
  elements.cropStep.hidden = step !== "crop";
  elements.reviewStep.hidden = step !== "review";
}

function openImportDialog() {
  if (!elements.dialog.open) elements.dialog.showModal();
  showImportStep(cropImage ? "crop" : "upload");
}

function resetImport() {
  stopCamera();
  cropImage = null;
  cropRect = null;
  importedValues = [];
  elements.imageInput.value = "";
  elements.scanButton.disabled = true;
  elements.scanButton.textContent = "Scan this grid ↗";
  elements.cropCanvas.width = 0;
  elements.cropCanvas.height = 0;
  document.querySelector("#scan-progress").hidden = true;
  document.querySelector("#upload-error").hidden = true;
  document.querySelector("#upload-error").textContent = "";
  document.querySelector("#choose-another").disabled = false;
}

async function startCamera() {
  const error = document.querySelector("#upload-error");
  error.hidden = true;
  error.textContent = "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showUploadError("Chrome needs this page to be open over HTTPS or localhost to use the camera. You can still upload a photo.");
    return;
  }
  elements.cameraButton.disabled = true;
  elements.cameraButton.textContent = "Waiting for camera permission…";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    if (!elements.dialog.open) {
      stopCamera();
      return;
    }
    elements.cameraVideo.srcObject = cameraStream;
    await elements.cameraVideo.play();
    elements.dropZone.hidden = true;
    document.querySelector("#camera-choice-separator").hidden = true;
    elements.cameraButton.hidden = true;
    elements.cameraPanel.hidden = false;
  } catch (cameraError) {
    stopCamera();
    if (cameraError.name === "NotAllowedError" || cameraError.name === "PermissionDeniedError") {
      showUploadError("Camera access was blocked. Allow camera access for this page in Chrome, then try again.");
    } else if (cameraError.name === "NotFoundError" || cameraError.name === "DevicesNotFoundError") {
      showUploadError("No camera was found. You can still choose or drop a photo.");
    } else {
      showUploadError("The camera could not be opened. Check that it is connected and available to Chrome.");
    }
  } finally {
    elements.cameraButton.disabled = false;
    elements.cameraButton.innerHTML = '<span aria-hidden="true">◎</span> Use this device’s camera';
  }
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.cameraVideo.srcObject = null;
  elements.cameraPanel.hidden = true;
  elements.cameraButton.hidden = false;
  elements.dropZone.hidden = false;
  document.querySelector("#camera-choice-separator").hidden = false;
}

async function captureCameraPhoto() {
  const video = elements.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) {
    showUploadError("The camera is still starting. Wait a moment and try again.");
    return;
  }
  elements.capturePhotoButton.disabled = true;
  try {
    const canvas = document.createElement("canvas");
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The camera photo could not be saved.")), "image/jpeg", .92);
    });
    stopCamera();
    acceptImage(photo);
  } catch (captureError) {
    showUploadError(captureError.message || "The camera photo could not be saved. Try again.");
  } finally {
    elements.capturePhotoButton.disabled = false;
  }
}

function acceptImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    showUploadError("Please choose an image file.");
    return;
  }
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    document.querySelector("#upload-error").hidden = true;
    cropImage = image;
    const maxDimension = 1400;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = elements.cropCanvas;
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    cropRect = null;
    drawCropCanvas();
    elements.scanButton.disabled = true;
    showImportStep("crop");
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    showUploadError("This image could not be opened in your browser. Try a JPG or PNG.");
  };
  image.src = objectUrl;
}

function showUploadError(message) {
  const error = document.querySelector("#upload-error");
  error.textContent = message;
  error.hidden = false;
}

function setImportStatus(message) {
  const status = document.querySelector("#scan-status");
  status.textContent = message;
  document.querySelector("#scan-progress").hidden = false;
}

function canvasPoint(event) {
  const rect = elements.cropCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(elements.cropCanvas.width, (event.clientX - rect.left) * elements.cropCanvas.width / rect.width)),
    y: Math.max(0, Math.min(elements.cropCanvas.height, (event.clientY - rect.top) * elements.cropCanvas.height / rect.height)),
  };
}

function drawCropCanvas() {
  if (!cropImage) return;
  const canvas = elements.cropCanvas;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cropImage, 0, 0, canvas.width, canvas.height);
  if (!cropRect || cropRect.width < 1 || cropRect.height < 1) return;
  const { x, y, width, height } = cropRect;
  context.fillStyle = "rgb(28 36 28 / 42%)";
  context.fillRect(0, 0, canvas.width, y);
  context.fillRect(0, y + height, canvas.width, canvas.height - y - height);
  context.fillRect(0, y, x, height);
  context.fillRect(x + width, y, canvas.width - x - width, height);
  context.strokeStyle = "#f8fff3";
  context.lineWidth = Math.max(2, canvas.width / 500);
  context.setLineDash([8, 5]);
  context.strokeRect(x, y, width, height);
  context.setLineDash([]);
  context.fillStyle = "#f8fff3";
  const handleSize = Math.max(5, canvas.width / 85);
  for (const [hx, hy] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
    context.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }
}

function startCropSelection(event) {
  if (!cropImage) return;
  event.preventDefault();
  cropDragStart = canvasPoint(event);
  cropRect = { x: cropDragStart.x, y: cropDragStart.y, width: 0, height: 0 };
  elements.cropCanvas.setPointerCapture(event.pointerId);
  drawCropCanvas();
}

function updateCropSelection(event) {
  if (!cropDragStart) return;
  const point = canvasPoint(event);
  cropRect = {
    x: Math.min(cropDragStart.x, point.x),
    y: Math.min(cropDragStart.y, point.y),
    width: Math.abs(point.x - cropDragStart.x),
    height: Math.abs(point.y - cropDragStart.y),
  };
  elements.scanButton.disabled = Math.min(cropRect.width, cropRect.height) < elements.cropCanvas.width * .12;
  drawCropCanvas();
}

function endCropSelection() {
  if (!cropDragStart) return;
  cropDragStart = null;
  if (!cropRect || Math.min(cropRect.width, cropRect.height) < elements.cropCanvas.width * .12) {
    cropRect = null;
    elements.scanButton.disabled = true;
  } else {
    document.querySelector("#scan-progress").hidden = true;
  }
  drawCropCanvas();
}

function preprocessCell(row, col) {
  const size = 150;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "white";
  context.fillRect(0, 0, size, size);
  const marginX = cropRect.width / 9 * .16;
  const marginY = cropRect.height / 9 * .16;
  const sourceX = cropRect.x + col * cropRect.width / 9 + marginX;
  const sourceY = cropRect.y + row * cropRect.height / 9 + marginY;
  const sourceWidth = cropRect.width / 9 - 2 * marginX;
  const sourceHeight = cropRect.height / 9 - 2 * marginY;
  context.drawImage(elements.cropCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 12, 12, size - 24, size - 24);
  const imageData = context.getImageData(0, 0, size, size);
  const grayValues = new Uint8Array(size * size);
  const histogram = new Uint32Array(256);
  for (let pixel = 0; pixel < grayValues.length; pixel += 1) {
    const offset = pixel * 4;
    const gray = Math.round(imageData.data[offset] * .299 + imageData.data[offset + 1] * .587 + imageData.data[offset + 2] * .114);
    grayValues[pixel] = gray;
    histogram[gray] += 1;
  }
  const total = grayValues.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = 0;
  let threshold = 155;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const meanBackground = backgroundSum / backgroundWeight;
    const meanForeground = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  let ink = 0;
  for (let pixel = 0; pixel < grayValues.length; pixel += 1) {
    const dark = grayValues[pixel] < Math.min(205, threshold + 10);
    const offset = pixel * 4;
    const shade = dark ? 0 : 255;
    imageData.data[offset] = shade;
    imageData.data[offset + 1] = shade;
    imageData.data[offset + 2] = shade;
    imageData.data[offset + 3] = 255;
    if (dark) ink += 1;
  }
  context.putImageData(imageData, 0, 0);
  const inkRatio = ink / total;
  return inkRatio > .009 && inkRatio < .46 ? canvas : null;
}

async function loadOcr() {
  if (!window.Tesseract) {
    if (!ocrScriptPromise) {
      ocrScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = OCR_SCRIPT_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error("The scanner could not be loaded. Check your connection and try again."));
        document.head.append(script);
      });
    }
    await ocrScriptPromise;
  }
  if (!ocrWorker) {
    const tesseract = window.Tesseract;
    ocrWorker = await tesseract.createWorker("eng", 1, {
      logger: (progress) => {
        if (progress.status === "recognizing text") {
          document.querySelector("#scan-status").textContent = "Reading the clues in your picture…";
        }
      },
    });
    await ocrWorker.setParameters({
      tessedit_char_whitelist: "123456789",
      tessedit_pageseg_mode: tesseract.PSM?.SINGLE_CHAR ?? "10",
    });
  }
  return ocrWorker;
}

async function scanImage() {
  if (!cropRect || elements.scanButton.disabled) return;
  elements.scanButton.disabled = true;
  document.querySelector("#choose-another").disabled = true;
  document.querySelector("#scan-progress").hidden = false;
  document.querySelector("#progress-bar").style.width = "2%";
  setImportStatus("Loading the on-device scanner…");
  try {
    const worker = await loadOcr();
    const prepared = Array.from({ length: 81 }, (_, index) => preprocessCell(Math.floor(index / 9), index % 9));
    const inkCells = prepared.reduce((count, cell) => count + Number(Boolean(cell)), 0);
    if (inkCells === 0) throw new Error("No digits were visible in that area. Try drawing closer to the puzzle grid.");
    importedValues = Array(81).fill(0);
    let finished = 0;
    document.querySelector("#scan-status").textContent = `Reading up to ${inkCells} filled squares…`;
    for (let index = 0; index < prepared.length; index += 1) {
      if (prepared[index]) {
        const result = await worker.recognize(prepared[index]);
        const match = result.data.text.match(/[1-9]/);
        importedValues[index] = match ? Number(match[0]) : 0;
      }
      finished += 1;
      document.querySelector("#progress-bar").style.width = `${Math.max(3, Math.round(finished / 81 * 100))}%`;
      document.querySelector("#scan-status").textContent = `Reading squares… ${finished} of 81`;
    }
    renderReviewGrid();
    showImportStep("review");
  } catch (error) {
    setImportStatus(error.message || "The scan did not finish. Try another picture.");
    elements.scanButton.disabled = false;
    document.querySelector("#choose-another").disabled = false;
  }
}

function renderReviewGrid() {
  elements.reviewGrid.replaceChildren();
  const duplicates = duplicateCells(importedValues);
  for (let index = 0; index < 81; index += 1) {
    const input = document.createElement("input");
    input.className = "review-cell";
    input.type = "text";
    input.inputMode = "numeric";
    input.maxLength = 1;
    input.autocomplete = "off";
    input.value = importedValues[index] || "";
    input.dataset.index = String(index);
    input.setAttribute("role", "gridcell");
    input.setAttribute("aria-label", `Row ${rowOf(index) + 1}, column ${colOf(index) + 1}`);
    if (duplicates.has(index)) input.classList.add("is-duplicate");
    elements.reviewGrid.append(input);
  }
  const count = importedValues.filter(Boolean).length;
  elements.reviewSummary.textContent = `${count} clues recognized · Tap a cell to correct it`;
  elements.reviewWarning.hidden = duplicates.size === 0;
  elements.reviewWarning.textContent = duplicates.size ? "Some clues repeat in a row, column, or square. Correct or clear the highlighted clues to continue." : "";
  elements.startPhotoGame.disabled = duplicates.size > 0;
}

function updateImportedCell(event) {
  const input = event.target.closest(".review-cell");
  if (!input) return;
  const value = input.value.replace(/[^1-9]/g, "").slice(-1);
  input.value = value;
  importedValues[Number(input.dataset.index)] = value ? Number(value) : 0;
  const next = Number(input.dataset.index) + 1;
  if (value && next < 81) elements.reviewGrid.querySelector(`[data-index="${next}"]`).focus();
  renderReviewGrid();
  const focusedIndex = value && next < 81 ? next : Number(input.dataset.index);
  elements.reviewGrid.querySelector(`[data-index="${focusedIndex}"]`).focus();
}

function startImportedGame() {
  const duplicates = duplicateCells(importedValues);
  if (duplicates.size) {
    renderReviewGrid();
    return;
  }
  if (importedValues.filter(Boolean).length < 10) {
    elements.reviewWarning.hidden = false;
    elements.reviewWarning.textContent = "This looks almost empty. Add the clues from the photo or scan a closer crop before starting.";
    return;
  }
  const solved = solveSudoku(importedValues, 2);
  if (!solved.solutions.length) {
    elements.reviewWarning.hidden = false;
    elements.reviewWarning.textContent = solved.exhausted
      ? "This puzzle has many possibilities. Check the clues and try again."
      : "These clues do not make a solvable Sudoku. Correct or clear a clue and try again.";
    return;
  }
  const hasMultipleSolutions = solved.solutions.length > 1;
  const importedPuzzle = [...importedValues];
  elements.dialog.close();
  resetImport();
  beginGame(importedPuzzle, solved.solutions[0], "imported");
  if (hasMultipleSolutions) setMessage("This photo puzzle has more than one possible solution. Hints follow one valid path.", "warning");
  else setMessage("Your photo puzzle is ready. A digit at a time.");
  saveGame();
}

function updateDate() {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 0);
  const ordinal = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - yearStart) / 86_400_000);
  document.querySelector("#puzzle-number").textContent = String(ordinal).padStart(3, "0");
  document.querySelector("#weekday").textContent = new Intl.DateTimeFormat("en", { weekday: "long" }).format(now).toUpperCase();
  document.querySelector("#date-label").textContent = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(now).toUpperCase();
}

elements.board.addEventListener("click", (event) => {
  const cell = event.target.closest(".sudoku-cell");
  if (!cell) return;
  selected = Number(cell.dataset.index);
  renderBoard();
  saveGame();
});

elements.numberButtons.addEventListener("click", (event) => {
  const button = event.target.closest(".number-button");
  if (button) enterDigit(Number(button.dataset.digit));
});
document.querySelector("#erase-button").addEventListener("click", eraseSelected);
elements.notesButton.addEventListener("click", () => {
  noteMode = !noteMode;
  elements.notesButton.setAttribute("aria-pressed", String(noteMode));
  setMessage(noteMode ? "Notes are on. Enter a candidate for this square." : "Notes are off.");
});
document.querySelector("#hint-button").addEventListener("click", useHint);
document.querySelector("#check-button").addEventListener("click", checkBoard);
document.querySelector("#new-game-button").addEventListener("click", () => newGame());
elements.difficulty.addEventListener("change", () => {
  if (elements.difficulty.value === "imported") openImportDialog();
});
document.querySelector("#scan-button").addEventListener("click", openImportDialog);
document.querySelector("#header-scan").addEventListener("click", openImportDialog);

document.addEventListener("keydown", (event) => {
  if (elements.dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (/^[1-9]$/.test(event.key)) {
    event.preventDefault();
    enterDigit(Number(event.key));
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    eraseSelected();
  } else if (event.key.toLowerCase() === "n") {
    noteMode = !noteMode;
    elements.notesButton.setAttribute("aria-pressed", String(noteMode));
    setMessage(noteMode ? "Notes are on. Enter a candidate for this square." : "Notes are off.");
  } else if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1, 0); }
  else if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1, 0); }
  else if (event.key === "ArrowLeft") { event.preventDefault(); moveSelection(0, -1); }
  else if (event.key === "ArrowRight") { event.preventDefault(); moveSelection(0, 1); }
});

document.querySelector("#close-dialog").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("close", stopCamera);
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});
elements.imageInput.addEventListener("change", (event) => acceptImage(event.target.files?.[0]));
elements.cameraButton.addEventListener("click", startCamera);
document.querySelector("#cancel-camera").addEventListener("click", stopCamera);
elements.capturePhotoButton.addEventListener("click", captureCameraPhoto);
elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("is-dragging");
});
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("is-dragging"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("is-dragging");
  acceptImage(event.dataTransfer.files?.[0]);
});
elements.cropCanvas.addEventListener("pointerdown", startCropSelection);
elements.cropCanvas.addEventListener("pointermove", updateCropSelection);
elements.cropCanvas.addEventListener("pointerup", endCropSelection);
elements.cropCanvas.addEventListener("pointercancel", endCropSelection);
elements.scanButton.addEventListener("click", scanImage);
document.querySelector("#choose-another").addEventListener("click", () => {
  resetImport();
  showImportStep("upload");
});
elements.reviewGrid.addEventListener("input", updateImportedCell);
elements.reviewGrid.addEventListener("keydown", (event) => {
  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    event.target.value = "";
    event.target.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const delta = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const index = Number(event.target.dataset.index);
    const next = Math.max(0, Math.min(80, index + delta));
    elements.reviewGrid.querySelector(`[data-index="${next}"]`).focus();
  }
});
document.querySelector("#back-to-photo").addEventListener("click", () => showImportStep("crop"));
elements.startPhotoGame.addEventListener("click", startImportedGame);
window.addEventListener("pagehide", stopCamera);

buildNumberPad();
updateDate();
if (!loadSavedGame()) newGame("medium");
else {
  elements.timer.textContent = formatTime(elapsedSeconds);
  renderBoard();
  startTimer();
}
