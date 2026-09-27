# Sudoku, at your pace

A small, browser-only Sudoku game. Start a generated puzzle or bring one from a photo: choose an image, draw around the 9×9 grid, scan its printed digits, then review and correct the clues before playing.

## Run it

Open `index.html` in a recent browser, or serve this directory with any static web server. To use the live camera in Chrome, open the game over HTTPS or localhost (for example, run `python3 -m http.server 8000` here and visit `http://localhost:8000`). Grant camera access when Chrome asks. No build step or package installation is required.

## Play

- Choose a difficulty and select **New game** for a fresh puzzle.
- Select a square and enter a digit with the number row, number pad, or on-screen keypad.
- Use **Notes** to pencil in candidates. **Erase**, **Hint**, and **Check** are available below the board.
- Arrow keys move between squares. Press `N` for Notes and `Delete` or `Backspace` to erase.
- Your current game and notes are saved in this browser.

## Bring a puzzle from a picture

Choose **Scan a puzzle**, then use **Use this device’s camera** for a live preview and photo capture, or drop/select an existing image. Drag a rectangle tightly around the grid. The scanner recognizes one cell at a time in the browser. Review the editable 9×9 clue grid, fix any OCR mistakes, and start playing.

The image stays in the browser; Tesseract.js and its English OCR data are loaded from jsDelivr on the first scan. The scanner works best with a clear, upright grid and printed digits. It does not automatically correct perspective or reliably read handwriting, so inspect the clues before starting.
