<?php?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bootstrap demo</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-sRIl4kxILFvY47J16cr9ZwB07vP4J8+LH7qKQnuqkuIAvNWLzeN8tE5YBujZqJLB" crossorigin="anonymous">
    <link rel="stylesheet" href="./styles/style.css">
</head>
<body>
    <form class="formular" method="post">
        <div class="mb-3 row">
          <label for="cislo1" class="col-2">Číslo 1</label>
          <input type="text" class="col-10" id="cislo1" name="cislo_1">
        </div>
        <div class="mb-3 row">
          <label for="cislo2" class="col">Zadaj svoje druhé číslo</label>
          <input type="text" class="col" id="cislo2">
        </div>
        <div class="mb-3 row">
          <label for="operacia" class="col">Zadaj operaciu</label>
          <select class="col" aria-label="Default select example">
            <option selected>Vyber operaciu</option>
            <option value="+">Plus</option>
            <option value="-">Minus</option>
            <option value="*">Krat</option>
            <option value="/">Deleno</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary">Submit</button>
      </form>
      <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" integrity="sha384-FKyoEForCGlyvwx9Hj09JcYn3nv7wiPVlz7YYwJrWVcXK/BmnVDxM+D2scQbITxI" crossorigin="anonymous"></script>
</body>
</html>