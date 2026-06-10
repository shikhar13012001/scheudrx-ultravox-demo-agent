class AppError extends Error {
  constructor(message, { statusCode = 500, expose = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

class BadRequestError extends AppError {
  constructor(message) {
    super(message, { statusCode: 400, expose: true });
  }
}

module.exports = {
  AppError,
  BadRequestError,
};
