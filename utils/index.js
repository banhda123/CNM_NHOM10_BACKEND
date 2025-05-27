import jwt from 'jsonwebtoken'

export const generateToken = (user) => {
  const accessToken = jwt.sign(
    {
      _id: user._id,
      name: user.name,
      phone: user.phone,
      password: user.password,
    },
    process.env.TOKEN_SECRET,
    {
      expiresIn: "1h",
    }
  );

  const refeshToken = jwt.sign(
    {
      _id: user._id,
      name: user.name,
      phone: user.phone,
      password: user.password,
    },
    process.env.REFESH_TOKEN_SECRET,
    {
      expiresIn: "1days",
    }
  );
    console.log({accessToken, accessToken})
  return {
    accessToken,
    refeshToken,
  };
};

export const isAuth = (req, res, next) => {
  const authorization = req.headers.authorization;
  console.log("Authorization header:", authorization);

  if (authorization) {
    const token = authorization.split(' ')[1]; 
    jwt.verify(
      token,
      process.env.TOKEN_SECRET,
      (err, decode) => {
        if (err) {
          console.log("Token verification error:", err);
          res.status(401).send({ message: "invalid token" });
        } else {
          req.user = decode;
          next();
        }
      }
    );
  } else {
    res.status(401).send({ message: "no token" });
  }
};

export const checkRefeshToken = (token) => {
  
  if (token) {
    jwt.verify(
      token,
      process.env.REFRESH_TOKEN_SECRET,
      (err, decode) => {
        if (err) {
          res.status(400).send({ message: "invalid token" });
        } else {
          
        }
      }
    );
  } else {
    res.status(401).send({ message: "no token" });
  }
};

