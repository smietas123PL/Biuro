import express from 'express';
import authRouter from './src/routes/auth.js';

const app = express();
app.use(express.json());
app.use('/auth', authRouter);

app.listen(3999, async () => {
    console.log('Server started');
    
    const email = `test_${Date.now()}@example.com`;
    try {
      // Register
      const res1 = await fetch('http://localhost:3999/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              email,
              password: 'Password@123',
              companyName: 'Test Inc'
          })
      });
      console.log('Register status:', res1.status);
      const body1 = await res1.json();
      console.log('Register body:', body1);

      // Login
      const res2 = await fetch('http://localhost:3999/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              email,
              password: 'Password@123'
          })
      });
      console.log('Login status:', res2.status);
      const body2 = await res2.json();
      console.log('Login body:', body2);
    } catch(e) {
      console.error(e);
    } finally {
      process.exit(0);
    }
});
