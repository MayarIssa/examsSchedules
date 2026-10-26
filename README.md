# NMU Exam Scheduler

A static website that builds midterm and final exam timetables from a student-enrollment Excel file.
Everything runs in the browser. Nothing is uploaded to a server.

## How to use
1. **Upload enrollments**: an Excel file with one row per student per course. Needs at least a student ID column and a course code column.
2. **Exam period**: first/last day, weekdays, holidays, optional extra days (used only if they help), and exam times.
3. **Fixed exams**: courses whose date and time are set from outside (university requirements, courses shared with other faculties). They never move.
4. **Exam rooms**: set the rooms and seats per room (default 30 rooms × 25 seats). All rooms together are the seat limit per exam time, and students are assigned to rooms after scheduling.
5. **Rules**: max exams per student per day, and how strongly to avoid 2/3/4 exams in one day or exams on back-to-back days.
6. **Generate**, review, edit by hand if needed, and download the Excel file.

**TAs tab** (invigilation): upload the TA names (Word sheet, Excel/CSV or pasted text), set TAs per room, extra posts (e.g. floor supervisors), days off per TA and exam times per TA, and add requested days off or a TA's own exam times. The website gives each TA their days off on the quietest days and fills every room in use, then exports a timetable like the paper invigilation sheet.

Midterm and final have separate settings. Settings and fixed exams are saved in the browser and can be exported/imported as a JSON file.

## Files
- `index.html`, `style.css`, `app.js`: the interface
- `i18n.js`: all interface text in English and Arabic
- `solver.js`: the scheduler (greedy start + simulated annealing), runs in a Web Worker
- `vendor/xlsx.full.min.js`: SheetJS 0.18.5 for reading/writing Excel

Deploy: any static host. On Vercel, no build step is needed.
