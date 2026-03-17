const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());

app.use(cors({ origin: env.CORS_ORIGIN }));

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
