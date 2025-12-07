# D.PotD Enhanced Admin Portal

A comprehensive mathematics competition platform with **AI-powered grading**, **multi-grader system**, and **email notifications**.

## 🚀 Features

### ✅ Gemini AI Auto-Grading
- One-click AI grading for Q3 (proof/explanation) submissions
- Generates LaTeX-formatted feedback in a formal 10th-grade tone
- Configurable confidence levels
- Bulk grading for pending submissions

### ✅ Multi-Grader System
- Create and manage grader accounts
- Auto-assign submissions to graders (round-robin)
- Dedicated grader portal with queue management
- Track grader workload and completion stats

### ✅ Email Notifications
- Automatic notifications when feedback is ready
- Professional HTML email templates via Resend
- Bulk notification support
- Tracking of notification status

### ✅ Secure Deployment
- All API keys stored as environment variables
- Server-side API endpoints for sensitive operations
- Firebase security rules for data protection

---

## 📁 Project Structure

```
dpotd-enhanced/
├── api/                          # Vercel serverless functions
│   ├── grade-submission.js       # Gemini AI grading
│   ├── send-notification.js      # Email via Resend
│   └── assign-graders.js         # Grader management
├── public/                       # Static files
│   ├── admin.html                # Admin portal
│   ├── admin-firebase.js         # Admin logic
│   ├── grader.html               # Grader portal
│   ├── grader-firebase.js        # Grader logic
│   ├── student.html              # Student portal
│   ├── student-firebase.js       # Student logic
│   └── firebase-config.js        # Firebase configuration
├── .env.example                  # Environment variable template
├── vercel.json                   # Vercel configuration
└── package.json                  # Dependencies
```

---

## 🛠 Setup & Deployment

### Prerequisites
- Node.js 18+
- Firebase project with Firestore enabled
- Vercel account
- Resend account (for emails)
- Gemini API key

### 1. Clone & Install

```bash
cd dpotd-enhanced
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:
```env
# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Email (Resend)
RESEND_API_KEY=your-resend-api-key
NOTIFICATION_FROM_EMAIL=noreply@yourdomain.com
```

### 3. Local Development

```bash
npm run dev
# or
npx vercel dev
```

Access the app at:
- Student Portal: http://localhost:3000
- Admin Portal: http://localhost:3000/admin.html
- Grader Portal: http://localhost:3000/grader.html

### 4. Deploy to Vercel

```bash
npx vercel
```

Or connect your repository to Vercel for automatic deployments.

### 5. Set Environment Variables on Vercel

In your Vercel project dashboard:
1. Go to **Settings** → **Environment Variables**
2. Add:
   - `GEMINI_API_KEY`
   - `RESEND_API_KEY`
   - `NOTIFICATION_FROM_EMAIL`

---

## 📋 Firestore Schema

### users
```javascript
{
  email: "user@example.com",
  name: "User Name",
  isAdmin: boolean,
  isGrader: boolean,
  createdAt: Timestamp
}
```

### submissions
```javascript
{
  studentEmail: "student@example.com",
  studentName: "Student Name",
  day: number,
  q1Answer: string,
  q2Answer: string,
  q3Answer: string,
  q1Correct: boolean,
  q2Correct: boolean,
  q3Score: number,        // 0-10
  q3Feedback: string,     // LaTeX
  gradingStatus: "pending" | "assigned" | "ai_graded" | "human_graded",
  assignedGrader: string, // grader UID
  notificationSent: boolean,
  timestamp: Timestamp
}
```

### questions
```javascript
{
  day: number,
  instructions: string,
  q1Text: string,
  q1Answer: string,
  q1Image: string,        // base64
  q2Text: string,
  q2Answer: string,
  q2Image: string,
  q3Text: string,
  q3Answer: string,
  q3Rubric: array
}
```

### schedule
```javascript
{
  day: number,
  openTime: Timestamp
}
```

---

## 🔐 Security Recommendations

1. **Firebase Rules**: Implement proper Firestore security rules
2. **Admin Verification**: Always verify admin status server-side
3. **Rate Limiting**: Consider adding rate limits to API endpoints
4. **Input Validation**: Sanitize all user inputs

---

## 📧 Email Configuration

### Using Resend

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain or use `onboarding@resend.dev` for testing
3. Add your API key to environment variables

### Email Types
- `feedback_ready` - Sent when Q3 grading is complete
- `reminder` - Upcoming test reminder
- `welcome` - New user welcome

---

## 🤖 AI Grading Customization

The AI grading prompt can be customized in `/api/grade-submission.js`:
- Modify the system prompt for different grading styles
- Adjust temperature for creativity vs consistency
- Add custom rubric parsing logic

---

## 📃 License

MIT License - See LICENSE file for details.

---

## 🆘 Support

For issues or feature requests, please open an issue on GitHub.
