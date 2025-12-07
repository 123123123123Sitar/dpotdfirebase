/**
 * D.PotD - Email Notification Endpoint
 * Sends feedback notifications to students using Gmail SMTP via Nodemailer
 * 
 * POST /api/send-notification
 * Body: { 
 *   studentEmail: string, 
 *   studentName: string, 
 *   day: number, 
 *   score: number,
 *   totalPossible: number,
 *   type: 'feedback_ready' | 'reminder' | 'welcome'
 * }
 */

const nodemailer = require('nodemailer');

// Create Gmail transporter
function createTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });
}

/**
 * Generate HTML email template for feedback notification
 */
function generateFeedbackEmail(studentName, day, score, totalPossible) {
    const percentage = Math.round((score / totalPossible) * 100);
    const gradeColor = percentage >= 80 ? '#28a745' : percentage >= 60 ? '#ffc107' : '#dc3545';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>D.PotD - Your Feedback is Ready</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <!-- Header -->
        <tr>
            <td style="background-color: #EA5A2F; padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">D.PotD</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">Daily Problem of the Day</p>
            </td>
        </tr>
        
        <!-- Content -->
        <tr>
            <td style="padding: 40px 30px;">
                <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px;">Hi ${studentName}!</h2>
                
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 25px 0;">
                    Great news! Your <strong>Day ${day}</strong> submission has been graded and feedback is now available.
                </p>
                
                <!-- Score Card -->
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; border-radius: 8px; margin-bottom: 25px;">
                    <tr>
                        <td style="padding: 25px; text-align: center;">
                            <p style="color: #666; margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your Score</p>
                            <p style="color: ${gradeColor}; margin: 0; font-size: 48px; font-weight: 700;">${score}<span style="font-size: 24px; color: #999;">/${totalPossible}</span></p>
                        </td>
                    </tr>
                </table>
                
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                    Log in to the student portal to view your detailed feedback and see how you can improve.
                </p>
                
                <!-- Tips Section -->
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                    <tr>
                        <td style="padding: 20px;">
                            <p style="color: #856404; margin: 0; font-size: 14px;">
                                <strong>Pro Tip:</strong> Review the rubric breakdown in your feedback to understand exactly where you earned points and where you can improve!
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        
        <!-- Footer -->
        <tr>
            <td style="background-color: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 1px solid #e9ecef;">
                <p style="color: #999; font-size: 12px; margin: 0;">
                    This email was sent by D.PotD. If you have questions, please contact your instructor.
                </p>
                <p style="color: #ccc; font-size: 11px; margin: 10px 0 0 0;">
                    © ${new Date().getFullYear()} D.PotD - Daily Problem of the Day
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();
}

/**
 * Generate plain text version of email
 */
function generatePlainTextEmail(studentName, day, score, totalPossible) {
    return `
Hi ${studentName}!

Great news! Your Day ${day} submission has been graded.

YOUR SCORE: ${score}/${totalPossible}

Log in to the student portal to view your detailed feedback and see how you can improve.

---
D.PotD - Daily Problem of the Day
    `.trim();
}

/**
 * Main API handler
 */
module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const {
            studentEmail,
            studentName,
            day,
            score,
            totalPossible = 20,
            type = 'feedback_ready'
        } = req.body;

        // Validate input
        if (!studentEmail || !studentName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: studentEmail and studentName'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(studentEmail)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Check for Gmail credentials
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            return res.status(500).json({
                success: false,
                error: 'Email service not configured. Missing Gmail credentials.'
            });
        }

        const transporter = createTransporter();

        // Generate email content based on type
        let subject, html, text;

        switch (type) {
            case 'feedback_ready':
                subject = `D.PotD Day ${day} - Your Feedback is Ready`;
                html = generateFeedbackEmail(studentName, day, score, totalPossible);
                text = generatePlainTextEmail(studentName, day, score, totalPossible);
                break;

            case 'reminder':
                subject = `D.PotD Reminder - Don't forget today's test!`;
                html = `<p>Hi ${studentName}, don't forget to complete today's D.PotD test!</p>`;
                text = `Hi ${studentName}, don't forget to complete today's D.PotD test!`;
                break;

            case 'welcome':
                subject = `Welcome to D.PotD!`;
                html = `<p>Hi ${studentName}, welcome to D.PotD! Your account is now active.</p>`;
                text = `Hi ${studentName}, welcome to D.PotD! Your account is now active.`;
                break;

            case 'grader_welcome':
                subject = `D.PotD Grader Account - Welcome!`;
                html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <tr>
            <td style="background-color: #EA5A2F; padding: 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">D.PotD Grader Portal</h1>
            </td>
        </tr>
        <tr>
            <td style="padding: 40px 30px;">
                <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px;">Welcome, ${studentName}!</h2>
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    You have been added as a grader for the D.PotD (Daily Problem of the Day) Challenge.
                </p>
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    A separate email with a password reset link has been sent to you. Please use that link to set your password, then you can access the Grader Portal.
                </p>
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                    As a grader, you will be able to:
                </p>
                <ul style="color: #666; font-size: 16px; line-height: 1.8;">
                    <li>View submissions assigned to you</li>
                    <li>Review AI-suggested scores and feedback</li>
                    <li>Provide final scores and LaTeX feedback for Q3 proofs</li>
                </ul>
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin: 20px 0 0 0;">
                    If you have any questions, please contact dtechmathclub@gmail.com.
                </p>
            </td>
        </tr>
        <tr>
            <td style="background-color: #f8f9fa; padding: 25px 30px; text-align: center; border-top: 1px solid #e9ecef;">
                <p style="color: #999; font-size: 12px; margin: 0;">
                    Design Tech Math Club - D.PotD Team
                </p>
            </td>
        </tr>
    </table>
</body>
</html>`;
                text = `Welcome ${studentName}!\n\nYou have been added as a grader for D.PotD. A separate email with a password reset link has been sent. Use that to set your password and access the Grader Portal.\n\nIf you have questions, contact dtechmathclub@gmail.com.\n\n- D.PotD Team`;
                break;

            default:
                subject = `D.PotD Notification`;
                html = `<p>Hi ${studentName}, you have a new notification from D.PotD.</p>`;
                text = `Hi ${studentName}, you have a new notification from D.PotD.`;
        }

        // Send email via Gmail
        const mailOptions = {
            from: `D.PotD <${process.env.GMAIL_USER}>`,
            to: studentEmail,
            subject: subject,
            html: html,
            text: text
        };

        const info = await transporter.sendMail(mailOptions);

        return res.status(200).json({
            success: true,
            messageId: info.messageId,
            message: `Email sent successfully to ${studentEmail}`
        });

    } catch (error) {
        console.error('Send notification error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to send notification'
        });
    }
};
