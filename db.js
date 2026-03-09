const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255),
        company VARCHAR(255),
        phone VARCHAR(50),
        email VARCHAR(255),
        comm_method VARCHAR(50),
        selected_services TEXT,
        form_data JSONB,
        additional_notes TEXT,
        status VARCHAR(20) DEFAULT 'new',
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
        invoice_number VARCHAR(20),
        amount NUMERIC(10,2) NOT NULL,
        description TEXT,
        token TEXT,
        transaction_id VARCHAR(100),
        auth_code VARCHAR(50),
        status VARCHAR(30) DEFAULT 'pending',
        authnet_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('Database initialized - contacts & payments tables ready');
  } finally {
    client.release();
  }
}

async function createContact(data) {
  const { fullName, company, phone, email, commMethod, selectedServices, additionalNotes, ...rest } = data;
  const result = await pool.query(
    `INSERT INTO contacts (full_name, company, phone, email, comm_method, selected_services, form_data, additional_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [fullName || '', company || '', phone || '', email || '', commMethod || '', selectedServices || '', JSON.stringify(data), additionalNotes || '']
  );
  return formatContact(result.rows[0]);
}

async function getContacts({ search, service, status } = {}) {
  let query = 'SELECT * FROM contacts';
  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`(full_name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx} OR company ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  if (service) {
    conditions.push(`selected_services ILIKE $${idx}`);
    params.push(`%${service}%`);
    idx++;
  }
  if (status) {
    conditions.push(`status = $${idx}`);
    params.push(status);
    idx++;
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY submitted_at DESC';

  const result = await pool.query(query, params);
  return result.rows.map(formatContact);
}

async function getContactById(id) {
  const result = await pool.query('SELECT * FROM contacts WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return formatContact(result.rows[0]);
}

async function updateContactStatus(id, status) {
  const validStatuses = ['new', 'contacted', 'completed'];
  if (!validStatuses.includes(status)) throw new Error('Invalid status');
  const result = await pool.query(
    'UPDATE contacts SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  if (result.rows.length === 0) return null;
  return formatContact(result.rows[0]);
}

async function deleteContact(id) {
  const result = await pool.query('DELETE FROM contacts WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}

async function getStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'new') AS new,
      COUNT(*) FILTER (WHERE status = 'contacted') AS contacted,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed
    FROM contacts
  `);
  const row = result.rows[0];
  return {
    total: parseInt(row.total),
    new: parseInt(row.new),
    contacted: parseInt(row.contacted),
    completed: parseInt(row.completed),
  };
}

function formatContact(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    commMethod: row.comm_method,
    selectedServices: row.selected_services,
    formData: row.form_data,
    additionalNotes: row.additional_notes,
    status: row.status,
    submittedAt: row.submitted_at,
  };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

async function createPayment({ contactId, invoiceNumber, amount, description, token }) {
  const result = await pool.query(
    `INSERT INTO payments (contact_id, invoice_number, amount, description, token)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [contactId, invoiceNumber, parseFloat(amount).toFixed(2), description || '', token]
  );
  return formatPayment(result.rows[0]);
}

async function updatePaymentByTransaction({ transactionId, authCode, status, authnetResponse }) {
  // Try matching by transaction_id first, fall back to most recent pending for this transaction
  const result = await pool.query(
    `UPDATE payments
     SET transaction_id = $1, auth_code = $2, status = $3, authnet_response = $4, updated_at = NOW()
     WHERE id = (
       SELECT id FROM payments
       WHERE (transaction_id = $1 OR (transaction_id IS NULL AND status = 'pending'))
       ORDER BY created_at DESC LIMIT 1
     )
     RETURNING *`,
    [transactionId, authCode || null, status, JSON.stringify(authnetResponse || {})]
  );
  if (result.rows.length === 0) return null;
  return formatPayment(result.rows[0]);
}

async function updatePaymentByToken(token, { transactionId, authCode, status, authnetResponse }) {
  const result = await pool.query(
    `UPDATE payments
     SET transaction_id = $1, auth_code = $2, status = $3, authnet_response = $4, updated_at = NOW()
     WHERE token = $5
     RETURNING *`,
    [transactionId || null, authCode || null, status, JSON.stringify(authnetResponse || {}), token]
  );
  if (result.rows.length === 0) return null;
  return formatPayment(result.rows[0]);
}

async function getPaymentsByContact(contactId) {
  const result = await pool.query(
    'SELECT * FROM payments WHERE contact_id = $1 ORDER BY created_at DESC',
    [contactId]
  );
  return result.rows.map(formatPayment);
}

function formatPayment(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    invoiceNumber: row.invoice_number,
    amount: parseFloat(row.amount),
    description: row.description,
    token: row.token,
    transactionId: row.transaction_id,
    authCode: row.auth_code,
    status: row.status,
    authnetResponse: row.authnet_response,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  initDB, createContact, getContacts, getContactById, updateContactStatus, deleteContact, getStats,
  createPayment, updatePaymentByTransaction, updatePaymentByToken, getPaymentsByContact,
};
