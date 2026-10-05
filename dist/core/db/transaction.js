export function withTransaction(database, operation) {
    return database.transaction().execute(operation);
}
//# sourceMappingURL=transaction.js.map