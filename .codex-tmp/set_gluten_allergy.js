const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const userId = '58f0010a-5c99-4234-b7f4-09c2bb13e0b4';

  await client.connect();
  await client.query('BEGIN');

  try {
    const before = await client.query(
      'select user_id, dietary_preferences from long_term_memory where user_id = $1 limit 1',
      [userId]
    );

    await client.query(
      `insert into long_term_memory (user_id, dietary_preferences, personal_details, order_history_summary, conversation_style)
       values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)
       on conflict (user_id)
       do update set
         dietary_preferences = jsonb_set(coalesce(long_term_memory.dietary_preferences, '{}'::jsonb), '{allergies,gluten}', 'true'::jsonb, true),
         updated_at = now()`,
      [userId, JSON.stringify({ allergies: { gluten: true } }), '{}', '{}', '{}']
    );

    const after = await client.query(
      'select user_id, dietary_preferences, updated_at from long_term_memory where user_id = $1 limit 1',
      [userId]
    );

    await client.query('COMMIT');

    console.log(JSON.stringify({ before: before.rows[0] ?? null, after: after.rows[0] ?? null }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
